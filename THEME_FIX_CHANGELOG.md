# Theme Fix — Sprint 1

Implemented:

- Reliable dark/light switching from both login and application headers.
- Immediate DOM update before React re-render.
- Theme persistence in localStorage.
- Server preference hydration only when no local preference exists.
- Optimistic authenticated-user cache update.
- Prevention of stale server responses reverting a recent toggle.
- Pre-render theme bootstrap in `client/index.html` to prevent light-mode flash.
- Native controls follow the active `color-scheme`.
- Accessible labels and pressed state on theme buttons.
- TypeScript 6 compatible path configuration (removed deprecated `baseUrl`).

Validation:

- TypeScript project build completed successfully.
- Full Vite build could not run in the Linux workspace because the uploaded
  `node_modules` contains Windows native Rolldown bindings. A fresh `npm install`
  on Windows installs the correct binding.
