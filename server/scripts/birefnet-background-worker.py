import argparse
import base64
import io
import json
import sys
import traceback

from PIL import Image
import torch
from torchvision import transforms
from transformers import AutoModelForImageSegmentation


def emit(payload):
    print(json.dumps(payload, separators=(",", ":")), flush=True)


def load_model(model_name):
    device = "cuda" if torch.cuda.is_available() else "cpu"
    torch.set_grad_enabled(False)
    model = AutoModelForImageSegmentation.from_pretrained(
        model_name,
        trust_remote_code=True,
    )
    model.to(device)
    if device == "cpu":
        model.float()
    model.eval()
    return model, device


def preprocess(image, image_size):
    transform = transforms.Compose(
        [
            transforms.Resize((image_size, image_size), interpolation=transforms.InterpolationMode.BICUBIC),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ]
    )
    return transform(image).unsqueeze(0)


def extract_prediction(output):
    prediction = output[-1] if isinstance(output, (list, tuple)) else output
    if isinstance(prediction, (list, tuple)):
        prediction = prediction[-1]
    return prediction.sigmoid().detach().cpu()[0].squeeze()


def remove_background(model, device, image_bytes, image_size):
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    model_input = preprocess(image, image_size).to(device)

    with torch.inference_mode():
        prediction = extract_prediction(model(model_input))

    mask = transforms.ToPILImage()(prediction)
    mask = mask.resize(image.size, Image.Resampling.LANCZOS)

    result = image.convert("RGBA")
    result.putalpha(mask)

    output = io.BytesIO()
    result.save(output, format="PNG", optimize=True)
    return output.getvalue()


def main():
    parser = argparse.ArgumentParser(description="Persistent BiRefNet background-removal worker.")
    parser.add_argument("--model", default="ZhengPeng7/BiRefNet")
    parser.add_argument("--image-size", type=int, default=1024)
    args = parser.parse_args()

    try:
        model, device = load_model(args.model)
        emit({"event": "ready", "model": args.model, "device": device})
    except Exception as error:
        emit({"event": "fatal", "error": str(error)})
        return 1

    for line in sys.stdin:
        try:
            request = json.loads(line)
            request_id = request["id"]
            image_bytes = base64.b64decode(request["imageBase64"])
            result = remove_background(model, device, image_bytes, args.image_size)
            emit(
                {
                    "id": request_id,
                    "ok": True,
                    "imageBase64": base64.b64encode(result).decode("ascii"),
                }
            )
        except Exception as error:
            emit(
                {
                    "id": request.get("id") if "request" in locals() else None,
                    "ok": False,
                    "error": str(error),
                    "trace": traceback.format_exc(limit=4),
                }
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
