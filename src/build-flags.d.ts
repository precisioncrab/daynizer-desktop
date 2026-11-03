// Build-time constant injected by Vite's `define`: true in the Thunderbird
// add-on build (thunderbird-addon/vite.config.ts), false in the desktop
// renderer (vite.config.ts). See src/httpsOnly.ts.
declare const __ADDON__: boolean;
