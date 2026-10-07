/**
 * CSS da janela de pagamento (posto pelo script, só quando a janela abre).
 * Pensado primeiro para o celular: no celular a janela sobe de baixo
 * (folha), no computador fica centralizada. Cada regra repete fonte, cores,
 * margens e bordas: páginas clonadas costumam ter CSS global (button, input,
 * h2, p…) que bagunçaria a janela. A cor de destaque vem do botão clicado
 * (--os-pw-a, texto em --os-pw-on). Prefixo os-pw- (payment window): a classe
 * os-pay já existe no modelo de página de vendas ("🔒 Pagamento seguro…").
 * Compacto de propósito: entra no script de todas as páginas.
 */
const F = "font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
const RESET = "margin:0;padding:0;border:0;background:none;letter-spacing:0;text-transform:none;text-shadow:none;";

export const PAY_CSS =
  ".os-pw-open,.os-pw-open body{overflow:hidden!important}" +
  `.os-pw{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483640;display:flex;align-items:flex-end;justify-content:center;margin:0;padding:0;background:rgba(10,12,20,.62);${F}}` +
  ".os-pw[hidden],.os-pw [hidden]{display:none!important}" +
  ".os-pw *,.os-pw *::before,.os-pw *::after{box-sizing:border-box}" +
  `.os-pw-box{position:relative;width:100%;max-width:460px;max-height:94vh;max-height:94dvh;overflow:auto;-webkit-overflow-scrolling:touch;margin:0;padding:20px 18px 18px;padding-bottom:calc(18px + env(safe-area-inset-bottom));border:0;border-radius:20px 20px 0 0;background:#fff;color:#0f172a;text-align:left;${F}font-size:15px;line-height:1.45;box-shadow:0 -10px 40px rgba(0,0,0,.25);animation:os-pw-up .28s ease-out both}` +
  "@keyframes os-pw-up{from{transform:translateY(40px);opacity:0}}" +
  "@media (min-width:560px){.os-pw{align-items:center;padding:24px}.os-pw-box{max-height:calc(100vh - 48px);padding:28px 28px 22px;border-radius:20px;box-shadow:0 30px 80px rgba(0,0,0,.35)}}" +
  `.os-pw-x{position:absolute;top:10px;right:10px;width:40px;height:40px;${RESET}border-radius:50%;background:#f1f5f9;color:#334155;font:24px/40px sans-serif;text-align:center;cursor:pointer}` +
  `.os-pw-k{${RESET}padding-right:44px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}` +
  `.os-pw-n{${RESET}margin-top:4px;padding-right:40px;color:#0f172a;font-size:18px;font-weight:800;line-height:1.3}` +
  `.os-pw-p{${RESET}margin-top:2px;color:#0f172a;font-size:26px;font-weight:900;line-height:1.2;font-variant-numeric:tabular-nums}` +
  `.os-pw-sim{${RESET}margin-top:12px;padding:8px 12px;border-radius:10px;background:#fef3c7;color:#92400e;font-size:13px;line-height:1.4}` +
  ".os-pw-body{margin:16px 0 0}" +
  `.os-pw-t{${RESET}margin-bottom:8px;color:#334155;font-size:14px;font-weight:700}` +
  `.os-pw-txt{${RESET}margin:0 0 12px;color:#334155;font-size:15px}` +
  ".os-pw-ms{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 14px;padding:0;border:0}" +
  ".os-pw-ms.os-pw-1{grid-template-columns:1fr}" +
  `.os-pw-m{position:relative;display:flex;flex-direction:column;justify-content:center;min-height:60px;${RESET}padding:9px 12px;border:2px solid #e2e8f0;border-radius:12px;background:#fff;color:#0f172a;cursor:pointer}` +
  ".os-pw-m input{position:absolute;opacity:0;width:1px;height:1px;margin:0}" +
  ".os-pw-m b{display:block;font-size:15px;font-weight:800;line-height:1.25}.os-pw-m small{display:block;margin-top:2px;color:#64748b;font-size:12px;line-height:1.3}" +
  ".os-pw-m.os-pw-on{border-color:var(--os-pw-a);background:#f8fafc;box-shadow:inset 0 0 0 1px var(--os-pw-a)}" +
  ".os-pw-m:focus-within{outline:3px solid var(--os-pw-a);outline-offset:2px}" +
  ".os-pw-f{display:block;margin:0 0 12px}" +
  `.os-pw-f span{display:block;${RESET}margin-bottom:5px;color:#334155;font-size:13px;font-weight:700}` +
  `.os-pw-f input{display:block;width:100%;height:48px;${RESET}padding:0 14px;border:1.5px solid #cbd5e1;border-radius:12px;background:#fff;color:#0f172a;${F}font-size:16px;line-height:normal;box-shadow:none;-webkit-appearance:none;appearance:none}` +
  ".os-pw-f input:focus{border-color:var(--os-pw-a);outline:3px solid rgba(100,116,139,.25);outline-offset:0}" +
  ".os-pw-f input[aria-invalid=true]{border-color:#dc2626}" +
  `.os-pw-err{display:block;${RESET}margin-top:5px;color:#dc2626;font-size:13px;font-weight:600}` +
  `.os-pw-go,.os-pw-2{display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;${RESET}margin-top:14px;padding:12px 16px;border-radius:14px;${F}font-size:17px;font-weight:800;line-height:1.2;text-align:center;text-decoration:none;cursor:pointer}` +
  ".os-pw-go{background:var(--os-pw-a);color:var(--os-pw-on);box-shadow:0 10px 24px -12px var(--os-pw-a)}" +
  ".os-pw-2{margin-top:10px;border:1.5px solid #cbd5e1;background:#fff;color:#334155;font-size:15px;font-weight:700}" +
  ".os-pw-go:disabled{opacity:.6;cursor:default}" +
  `.os-pw-ln{display:block;${RESET}margin:12px auto 0;color:#475569;${F}font-size:14px;font-weight:600;text-decoration:underline;cursor:pointer}` +
  ".os-pw button:focus-visible,.os-pw a:focus-visible{outline:3px solid var(--os-pw-a);outline-offset:2px}" +
  ".os-pw-rows{margin:0;padding:0;border-top:1px solid #eef2f7}" +
  ".os-pw-r{display:flex;align-items:center;gap:10px;margin:0;padding:10px 0;border-bottom:1px solid #eef2f7}" +
  ".os-pw-r div{flex:1;min-width:0}" +
  `.os-pw-r dt{${RESET}color:#64748b;font-size:12px;font-weight:700}` +
  `.os-pw-r dd{${RESET}color:#0f172a;font-size:16px;font-weight:800;line-height:1.3;word-break:break-all}` +
  ".os-pw-r dd.os-pw-mono{font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:.04em}" +
  `.os-pw-cp{flex:none;${RESET}padding:8px 12px;border-radius:10px;background:#0f172a;color:#fff;${F}font-size:13px;font-weight:700;line-height:1;cursor:pointer}` +
  `.os-pw-st{display:flex;align-items:center;gap:10px;${RESET}margin-top:14px;padding:12px 14px;border-radius:12px;background:#f8fafc;color:#0f172a;font-size:15px;font-weight:700}` +
  ".os-pw-sp{flex:none;display:inline-block;width:18px;height:18px;border:2.5px solid #cbd5e1;border-top-color:var(--os-pw-a);border-radius:50%;animation:os-pw-r .8s linear infinite}" +
  ".os-pw-ctr .os-pw-sp{width:34px;height:34px;border-width:3.5px;margin:6px auto 12px;display:block}" +
  "@keyframes os-pw-r{to{transform:rotate(360deg)}}" +
  `.os-pw-note{${RESET}margin-top:10px;color:#64748b;font-size:13px}` +
  ".os-pw-old{margin-top:16px;padding:12px 14px;border-radius:12px;background:#fffbeb;text-align:center}" +
  ".os-pw-old .os-pw-note{margin-top:0;color:#92400e}" +
  ".os-pw-old .os-pw-ln{margin-top:6px}" +
  ".os-pw-ctr{padding:10px 0 4px;text-align:center}" +
  `.os-pw-ic{display:flex;align-items:center;justify-content:center;width:60px;height:60px;${RESET}margin:4px auto 12px;border-radius:50%;font:800 30px/1 sans-serif}` +
  ".os-pw-ok{background:#dcfce7;color:#16a34a}.os-pw-bad{background:#fee2e2;color:#dc2626}.os-pw-warn{background:#fef3c7;color:#b45309}" +
  `.os-pw-h{${RESET}color:#0f172a;font-size:20px;font-weight:800;line-height:1.3}` +
  ".os-pw-ctr .os-pw-txt{margin:6px 0 0;color:#475569}" +
  ".os-pw-card{min-height:90px;margin:4px 0 0}" +
  `.os-pw-fake{${RESET}padding:14px;border:2px dashed #cbd5e1;border-radius:12px;color:#64748b;font-size:13px;line-height:1.45}` +
  ".os-pw-simb{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0}" +
  `.os-pw-simb button{flex:1 1 180px;${RESET}min-height:42px;padding:8px 10px;border:1px solid #fcd34d;border-radius:10px;background:#fffbeb;color:#92400e;${F}font-size:13px;font-weight:700;cursor:pointer}` +
  `.os-pw-ft{${RESET}margin-top:16px;color:#64748b;font-size:12px;text-align:center}` +
  ".os-pw-sr{position:absolute!important;width:1px;height:1px;margin:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
  "@media (prefers-reduced-motion:reduce){.os-pw-box,.os-pw-sp{animation:none!important}}";
