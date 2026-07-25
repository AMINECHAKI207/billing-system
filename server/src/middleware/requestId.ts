import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';

const REQUEST_ID_HEADER = 'x-request-id';

export const requestId = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const incomingRequestId = req.header(REQUEST_ID_HEADER);
  const value = incomingRequestId?.trim() || randomUUID();

  res.locals.requestId = value;
  res.setHeader(REQUEST_ID_HEADER, value);
  next();
};
