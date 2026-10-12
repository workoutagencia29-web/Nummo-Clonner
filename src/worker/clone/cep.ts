/**
 * Atalho de CEP para páginas clonadas no modo "Com scripts".
 *
 * Muitas lojas/funis mostram um pop-up pedindo o CEP e, ao digitar, consultam
 * uma API de endereço e preenchem rua/bairro/cidade/UF. Quando essa consulta é
 * feita para o PRÓPRIO domínio do site (ex.: `/api/cep/<cep>`, `admin-ajax.php`,
 * `https://site.com/buscacep?cep=…`), a cópia estática não tem esse backend: o
 * endereço nunca aparece (404 na cópia, ou CORS se continuar apontando para o
 * site original). E se o site usava uma API pública mas tinha uma `<meta CSP>`
 * com `connect-src 'self'`, o navegador também barrava a consulta na cópia.
 *
 * Este script (ES5, alvo Safari 13) é injetado no começo do <head> das páginas
 * "Com scripts" que têm cara de usar CEP. Ele embrulha `fetch` e
 * `XMLHttpRequest`: quando a página consulta um CEP no próprio site (mesmo
 * domínio, caminho/consulta com "cep" e 8 dígitos), a chamada é atendida por
 * uma API pública (BrasilAPI, com ViaCEP de reserva) e a resposta volta com os
 * nomes de campo mais comuns (logradouro/rua/street, bairro/neighborhood,
 * localidade/cidade/city, uf/estado/state…), para o código do site achar o que
 * espera. Consultas que já vão direto para uma API pública passam sem mexer.
 *
 * Função pura que devolve o texto do script (sem rede, sem banco).
 */

const CEP_SCRIPT_ATTR = "data-os-cep";

/** Serviços de CEP conhecidos citados no código (sinal forte de que a página usa CEP). */
const CEP_SERVICE_RE =
  /\b(?:viacep|brasilapi|apicep|postmon|cepaberto|republicavirtual|opencep|awesomeapi|cepcerto|buscacepinter|widcep)\b/i;
/** Primitiva de requisição (fetch/XHR/axios/jQuery) usada para consultar o CEP. */
const REQUEST_RE = /\bfetch\s*\(|xmlhttprequest|\.open\s*\(|\$\.(?:get|post|ajax|getjson)|\baxios\b/i;

/**
 * Este trecho de código (um <script> inline) faz consulta de CEP? Serviço de
 * CEP conhecido, ou "cep" junto de uma requisição (fetch/XHR/ajax). Serve para
 * o modo Editável MANTER esse script (senão o pop-up de CEP para ao converter).
 */
export function isCepScript(code: string): boolean {
  if (CEP_SERVICE_RE.test(code)) return true;
  return /\bcep\b/i.test(code) && REQUEST_RE.test(code);
}

/**
 * A página (DOM renderizado/original) parece usar consulta de CEP? Campo com
 * "cep", texto da página com "cep", ou um script citando um serviço de CEP.
 */
export function pageUsesCep(html: string): boolean {
  if (CEP_SERVICE_RE.test(html)) return true;
  // Campo de formulário com cara de CEP (name/id/placeholder/autocomplete).
  if (/<input\b[^>]*(?:name|id|placeholder|autocomplete|aria-label)\s*=\s*["'][^"']*cep[^"']*["']/i.test(html))
    return true;
  // "cep" como palavra no texto visível (rótulo do campo, instrução do pop-up).
  if (/\bcep\b/i.test(html) && /\bfetch\b|xmlhttprequest|\$\.(?:get|post|ajax)|axios|\.open\s*\(/i.test(html))
    return true;
  return false;
}

/**
 * Script do atalho de CEP. `hosts`: os domínios originais da cópia (sem "www.";
 * as consultas a esses hosts, ou relativas/mesmo domínio, são atendidas aqui).
 */
export function cepShimScript(hosts: readonly string[]): string {
  const list = JSON.stringify([...new Set(hosts.map((h) => h.toLowerCase().replace(/^www\./, "")))]);
  // ES5, sem dependências, tudo dentro de um try para nunca quebrar a página.
  return `(function(){try{
var ORIG=${list};
function digits(s){return String(s==null?"":s).replace(/\\D/g,"");}
function cepFrom(s){var t=String(s==null?"":s);if(!/cep|postal|zip/i.test(t))return"";var m=t.match(/(\\d{5})[-\\s.]?(\\d{3})(?!\\d)/);return m?m[1]+m[2]:"";}
function known(host){host=String(host||"").toLowerCase().replace(/^www\\./,"");for(var i=0;i<ORIG.length;i++)if(host===ORIG[i]||host.indexOf("."+ORIG[i])===host.length-ORIG[i].length-1)return true;return false;}
function cepOfUrl(raw){var u;try{u=new URL(raw,location.href)}catch(e){return""}var host=u.host.toLowerCase();var mine=host===location.host.toLowerCase();if(!mine&&!known(host))return"";if(/(?:viacep|brasilapi|apicep|postmon|cepaberto|republicavirtual|opencep|awesomeapi|cepcerto)\\./i.test(host))return"";return cepFrom(u.pathname+u.search+u.hash)}
function norm(a){var cep=a.cep||"",rua=a.rua||"",bairro=a.bairro||"",cidade=a.cidade||"",uf=a.uf||"";return {cep:cep,logradouro:rua,rua:rua,endereco:rua,logadouro:rua,street:rua,address:rua,bairro:bairro,neighborhood:bairro,district:bairro,localidade:cidade,cidade:cidade,city:cidade,municipio:cidade,uf:uf,estado:uf,state:uf,ufSigla:uf,complemento:a.complemento||"",numero:"",ddd:a.ddd||"",ibge:a.ibge||"",siafi:"",gia:"",erro:false,ok:true,success:true,status:"success"}}
var _fetch=window.fetch?window.fetch.bind(window):null;
function viacep(cep){if(!_fetch)return Promise.resolve(null);return _fetch("https://viacep.com.br/ws/"+cep+"/json/").then(function(r){return r.json()}).then(function(d){return d&&!d.erro?norm({cep:d.cep,rua:d.logradouro,bairro:d.bairro,cidade:d.localidade,uf:d.uf,complemento:d.complemento,ddd:d.ddd,ibge:d.ibge}):null}).catch(function(){return null})}
function lookup(cep){if(!_fetch)return Promise.resolve(null);return _fetch("https://brasilapi.com.br/api/cep/v2/"+cep).then(function(r){return r.ok?r.json():null}).then(function(d){if(d&&d.cep)return norm({cep:d.cep,rua:d.street,bairro:d.neighborhood,cidade:d.city,uf:d.state});return viacep(cep)}).catch(function(){return viacep(cep)})}
function answer(cep){return lookup(cep).then(function(d){return d||{erro:true,cep:cep}})}
if(_fetch){window.fetch=function(input,init){var url=input&&input.url?input.url:input;var cep="";try{cep=cepOfUrl(url)}catch(e){}if(cep)return answer(cep).then(function(data){try{return new Response(JSON.stringify(data),{status:data.erro?404:200,headers:{"Content-Type":"application/json"}})}catch(e){var r={ok:!data.erro,status:data.erro?404:200,json:function(){return Promise.resolve(data)},text:function(){return Promise.resolve(JSON.stringify(data))}};return r}});return _fetch.apply(this,arguments)}}
var XO=window.XMLHttpRequest;
if(XO){function set(x,k,v){try{Object.defineProperty(x,k,{configurable:true,get:function(){return v}})}catch(e){try{x[k]=v}catch(e2){}}}
window.XMLHttpRequest=function(){var x=new XO(),url="";var open=x.open;x.open=function(m,u){url=u;return open.apply(x,arguments)};var send=x.send;x.send=function(){var cep="";try{cep=cepOfUrl(url)}catch(e){}if(!cep)return send.apply(x,arguments);answer(cep).then(function(data){var body=JSON.stringify(data);set(x,"readyState",4);set(x,"status",data.erro?404:200);set(x,"statusText",data.erro?"Not Found":"OK");set(x,"responseText",body);set(x,"response",body);set(x,"responseURL",String(url));try{x.onreadystatechange&&x.onreadystatechange()}catch(e){}try{x.onload&&x.onload()}catch(e){}try{x.dispatchEvent(new Event("readystatechange"))}catch(e){}try{x.dispatchEvent(new Event("load"))}catch(e){}try{x.dispatchEvent(new Event("loadend"))}catch(e){}})};return x};
try{window.XMLHttpRequest.prototype=XO.prototype}catch(e){}}
}catch(e){}})();`;
}

/** <script data-os-cep>…</script> (vai no começo do <head>). */
export function cepShimTag(hosts: readonly string[]): string {
  return `<script ${CEP_SCRIPT_ATTR}>${cepShimScript(hosts)}</script>`;
}
