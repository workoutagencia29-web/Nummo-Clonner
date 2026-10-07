/**
 * pagamento.php do ZIP: o servidor do pagamento na página (checkout
 * transparente) no site publicado — o mesmo contrato da prévia
 * (src/lib/payments/contract.ts; a prévia responde em simulação,
 * src/server/services/payments/simulation.ts), com a Kyvo de verdade.
 * PHP 7.4+, com cURL (ou allow_url_fopen), sem banco e sem dependências.
 *
 * - pagamento.php: o código (igual em todo ZIP, sem segredo nenhum). Recebe o
 *   POST JSON da janela de pagamento e do bloco "Acesso ao produto"
 *   (src/runtime/payments): criar a cobrança (valor e moeda SEMPRE do
 *   config.php; o servidor gera o pedido os_<código do produto>_<20>, que é
 *   também a Idempotency-Key, e completa a metadata com ip e ua), consultar o
 *   status (só o status e o que a janela precisa) e entregar o link de acesso
 *   (só para pedido PAGO, do produto do pedido — lido da Kyvo pelo
 *   externalOrderId, nunca do navegador). Confere tamanho (até
 *   PAYMENT_MAX_BODY), origem (mesmo site, como o eventos.php), cada campo
 *   (as regras de parsePaymentRequest) e limites por IP (arquivos em
 *   pagamento-dados/limites/). Nunca mostra a chave nem os erros da Kyvo: só
 *   os códigos do contrato. Aberto no navegador (GET), mostra se está
 *   funcionando (sem segredos).
 * - pagamento-dados/config.php: a chave da API e os produtos (valor, moeda,
 *   métodos, página de obrigado e link de acesso), num array PHP que nunca é
 *   impresso; aberto direto, 404. pagamento-dados/.htaccess bloqueia a pasta
 *   inteira no Apache/LiteSpeed (nada de .htaccess na raiz do ZIP).
 *
 * O endereço da API é fixo (https://kyvopay.com/api): os testes trocam o texto
 * do arquivo gerado para apontar para a Kyvo falsa (tests/unit/kyvo-fake.ts).
 *
 * ATENÇÃO: numa hospedagem sem PHP (só arquivos), o config.php seria entregue
 * como texto, com a chave. O aviso do ZIP, o LEIA-ME.txt e o painel avisam.
 */
import {
  PAY_STATUSES,
  PAYMENT_ERROR_STATUS,
  PAYMENT_MAX_BODY,
  PAYMENT_METADATA_KEYS,
  type PayCurrency,
  type PayMethod,
  PRODUCT_KEY_RE,
} from "@/lib/payments/contract";
import { METHOD_CURRENCIES } from "@/lib/payments/rules";
import { PHP_CLIENT_IP_FUNCTIONS, phpString } from "./php";

export const PAGAMENTO_FILE = "pagamento.php";
/** Pasta da chave (com o .htaccess dela e os limites por IP). */
export const PAGAMENTO_CONFIG_DIR = "pagamento-dados/";
export const PAGAMENTO_CONFIG_FILE = `${PAGAMENTO_CONFIG_DIR}config.php`;
export const PAGAMENTO_HTACCESS_FILE = `${PAGAMENTO_CONFIG_DIR}.htaccess`;

/** API da Kyvo usada pelo pagamento.php (a mesma de KYVO_API_BASE, src/server/services/payments/kyvo.ts). */
export const PAGAMENTO_KYVO_API = "https://kyvopay.com/api";
/**
 * Cobranças criadas por IP a cada PAGAMENTO_WINDOW_S (cartão recusado = cobrança
 * nova; folgado para isso). IPv6 conta por /64 (um só cliente tem o /64 inteiro).
 */
export const PAGAMENTO_CREATE_LIMIT = 20;
/** Cobranças por rede IPv6 /48 a cada PAGAMENTO_WINDOW_S (quem troca de /64 dentro da mesma rede). */
export const PAGAMENTO_CREATE_NET_LIMIT = 60;
/**
 * Cobranças "livres" de cada IP na janela: elas nunca contam no teto do site.
 * O teto só pesa para quem já criou mais que isso — um ataque de muitos IPs
 * não derruba as vendas de quem chega para comprar.
 */
export const PAGAMENTO_CREATE_FREE = 3;
/** Teto do site para as cobranças além das livres de cada IP, a cada PAGAMENTO_WINDOW_S. */
export const PAGAMENTO_CREATE_TOTAL = 1200;
/** Cobranças de cartão/Bizum/MB WAY por e-mail a cada PAGAMENTO_WINDOW_S (freia teste de cartões roubados). */
export const PAGAMENTO_CARD_EMAIL_LIMIT = 8;
/** Consultas (status e acesso) por IP a cada PAGAMENTO_WINDOW_S (a janela confere a cada ~4 s). */
export const PAGAMENTO_READ_LIMIT = 400;
export const PAGAMENTO_WINDOW_S = 600;
/** Tempo máximo de cada pedido à Kyvo (segundos); uma nova tentativa quando ela está fora do ar. */
export const PAGAMENTO_TIMEOUT_S = 12;

/** Produto como o pagamento.php conhece (só no config.php). */
export interface PagamentoProduct {
  /** Chave do link da oferta (data-os-pay). */
  key: string;
  /** Código do produto no pedido (orderProductCode). */
  code: string;
  name: string;
  amountCents: number;
  currency: PayCurrency;
  methods: PayMethod[];
  /** Pasta da página de obrigado no ZIP ("obrigado/"; "" = raiz), só para referência. */
  thankYou: string | null;
  /** Link de acesso entregue a quem pagou ("" = ainda não tem: não vende). */
  accessUrl: string;
}

export interface PagamentoConfig {
  /** Chave da API da Kyvo ("" = não cadastrada: o pagamento.php responde "configuracao"). */
  apiKey: string;
  products: PagamentoProduct[];
}

const phpList = (items: readonly string[]) => `array(${items.map(phpString).join(", ")})`;

function productEntry(p: PagamentoProduct): string {
  const amount = Number.isSafeInteger(p.amountCents) && p.amountCents > 0 ? p.amountCents : 0;
  return [
    `    ${phpString(p.key)} => array(`,
    `      'codigo' => ${phpString(p.code)},`,
    `      'nome' => ${phpString(p.name)},`,
    `      'valor' => ${amount},`,
    `      'moeda' => ${phpString(p.currency)},`,
    `      'metodos' => ${phpList(p.methods)},`,
    `      'obrigado' => ${p.thankYou === null ? "null" : phpString(p.thankYou)},`,
    `      'acesso' => ${phpString(p.accessUrl)},`,
    "    ),",
  ].join("\n");
}

/** pagamento-dados/config.php com a chave da API (só no ZIP; nunca vai para o HTML). */
export function pagamentoConfigPhp(config: PagamentoConfig): string {
  const products = config.products.length ? `array(\n${config.products.map(productEntry).join("\n")}\n  )` : "array()";
  return `<?php
// Offer Studio — chave da API da Kyvo e produtos do pagamento na página.
// Usado pelo pagamento.php. NÃO compartilhe este arquivo: com a chave,
// qualquer pessoa consegue criar cobranças e ver as suas vendas na Kyvo.
// Só funciona em hospedagem com PHP (veja o LEIA-ME.txt).
// Mudou o valor, o link de acesso ou a chave? Mude no Offer Studio e gere o ZIP de novo.
if (!defined('OS_PAGAMENTO')) {
  http_response_code(404);
  exit;
}

return array(
  'gateway' => 'kyvo',
  'chave' => ${phpString(config.apiKey)},
  'produtos' => ${products},
  // true só se o site fica atrás de um CDN/proxy que não seja a Cloudflare
  // (a Cloudflare já é reconhecida): aí o IP do comprador vem do cabeçalho
  // X-Forwarded-For. Deixe false se não tiver certeza.
  'trust_proxy' => false,
);
`;
}

/**
 * pagamento-dados/.htaccess (Apache/LiteSpeed: Hostinger, HostGator, cPanel):
 * nada da pasta abre pelo navegador (a chave e os limites por IP). Vale só
 * para essa pasta (nunca mexe no .htaccess da raiz da hospedagem).
 */
export function pagamentoHtaccess(): string {
  return `# Offer Studio: nada desta pasta (chave da Kyvo e controle de abuso do pagamento.php) pode ser aberto pelo navegador.
<IfModule mod_authz_core.c>
  Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
  Order allow,deny
  Deny from all
</IfModule>
`;
}

const phpArray = (items: readonly string[]) => `array(${items.map((i) => `'${i}'`).join(", ")})`;

const ERROR_STATUS = Object.entries(PAYMENT_ERROR_STATUS)
  .map(([code, status]) => `'${code}' => ${status}`)
  .join(", ");

/** Moedas aceitas por método (as de METHOD_CURRENCIES, com o nome do método como a página o chama: "mb_way"). */
const METHOD_CURRENCIES_PHP = Object.entries(METHOD_CURRENCIES)
  .map(([method, currencies]) => `'${method.toLowerCase()}' => ${phpArray(currencies)}`)
  .join(", ");

/**
 * pagamento.php (PHP 7.4+). Não tem segredos: lê a chave e os produtos do
 * pagamento-dados/config.php. Escrito como String.raw: as barras do PHP ficam
 * como estão (só os ${…} são do TypeScript).
 */
export function pagamentoPhp(): string {
  return String.raw`<?php
/**
 * Offer Studio — pagamento.php
 *
 * Pagamento na página (checkout transparente) com a Kyvo: a janela de
 * pagamento das páginas desta oferta pede aqui a cobrança (SPEI, cartão,
 * Bizum ou MB WAY) e confere o status; o bloco "Acesso ao produto" da página
 * de obrigado pede o link de acesso, que só sai para pedido PAGO, e do
 * produto desse pedido. A chave da API e os produtos (valor, moeda, métodos e
 * link de acesso) ficam em pagamento-dados/config.php: o valor cobrado nunca
 * vem do navegador.
 *
 * Requer PHP 7.4 ou mais novo, com cURL (ou allow_url_fopen), e o site em HTTPS.
 * Teste: abra https://seusite.com/pagamento.php no navegador.
 */

define('OS_PAGAMENTO', 1);
error_reporting(0);
@ini_set('display_errors', '0');
@set_time_limit(60);

const OS_MAX_BODY = ${PAYMENT_MAX_BODY};
const OS_API = '${PAGAMENTO_KYVO_API}';
const OS_CREATE_LIMIT = ${PAGAMENTO_CREATE_LIMIT};
const OS_CREATE_NET_LIMIT = ${PAGAMENTO_CREATE_NET_LIMIT};
const OS_CREATE_FREE = ${PAGAMENTO_CREATE_FREE};
const OS_CREATE_TOTAL = ${PAGAMENTO_CREATE_TOTAL};
const OS_CARD_EMAIL_LIMIT = ${PAGAMENTO_CARD_EMAIL_LIMIT};
const OS_READ_LIMIT = ${PAGAMENTO_READ_LIMIT};
const OS_WINDOW = ${PAGAMENTO_WINDOW_S};
const OS_TIMEOUT = ${PAGAMENTO_TIMEOUT_S};
const OS_DATA_DIR = '${PAGAMENTO_CONFIG_DIR.replace(/\/$/, "")}';
const OS_LIMIT_HEAD = "<?php exit; ?>\n";
const OS_METHODS = array('spei', 'card', 'bizum', 'mb_way');
const OS_STATUSES = ${phpArray(PAY_STATUSES)};
const OS_METADATA_KEYS = ${phpArray(PAYMENT_METADATA_KEYS)};
const OS_PRODUCT_RE = '/${PRODUCT_KEY_RE.source}/';
const OS_SDK_RE = '#^https://kyvopay\.com/sdk/[A-Za-z0-9._/-]+(?:\?[A-Za-z0-9=&._-]*)?$#';

/** Responde JSON e termina. */
function os_reply($status, $data)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('X-Robots-Tag: noindex');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

/** Erro do contrato ({ ok: false, erro }) com o status HTTP dele. */
function os_fail($code)
{
    $status = array(${ERROR_STATUS});
    os_reply(isset($status[$code]) ? $status[$code] : 400, array('ok' => false, 'erro' => $code));
}

function os_text($value)
{
    return is_string($value) ? $value : null;
}

function os_field($data, $key)
{
    return is_array($data) && isset($data[$key]) ? $data[$key] : null;
}

/** Quantos caracteres (UTF-8); -1 quando o texto não é UTF-8 válido. */
function os_len($text)
{
    $n = preg_match_all('/./su', $text);
    return $n === false ? -1 : $n;
}

/** Os primeiros $max caracteres (UTF-8). */
function os_cut($text, $max)
{
    return preg_match('/^.{0,' . (int) $max . '}/su', $text, $m) ? $m[0] : '';
}

/** Host de um endereço, em minúsculas ('' quando não tem). */
function os_host_of($url)
{
    $host = parse_url((string) $url, PHP_URL_HOST);
    return is_string($host) ? strtolower($host) : '';
}

${PHP_CLIENT_IP_FUNCTIONS}/**
 * Confere o pedido da página (as mesmas regras de parsePaymentRequest no
 * Offer Studio). null = inválido.
 */
function os_parse($o)
{
    if (!is_array($o) || !isset($o['acao']) || !is_string($o['acao'])) {
        return null;
    }
    $acao = $o['acao'];
    if ($acao === 'criar') {
        $produto = os_text(os_field($o, 'produto'));
        $metodo = os_text(os_field($o, 'metodo'));
        $nome = preg_replace('/\s+/u', ' ', trim((string) os_text(os_field($o, 'nome'))));
        $email = strtolower(trim((string) os_text(os_field($o, 'email'))));
        $documento = strtoupper(trim((string) os_text(os_field($o, 'documento'))));
        if ($produto === null || !preg_match(OS_PRODUCT_RE, $produto)) {
            return null;
        }
        if ($metodo === null || !in_array($metodo, OS_METHODS, true)) {
            return null;
        }
        $length = is_string($nome) ? os_len($nome) : -1;
        if ($length < 2 || $length > 120) {
            return null;
        }
        if (strlen($email) > 254 || !preg_match('/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@.]{2,63}$/u', $email)) {
            return null;
        }
        if ($documento !== '' && !preg_match('#^[A-Za-z0-9./-]{4,40}$#', $documento)) {
            return null;
        }
        $out = array('acao' => 'criar', 'produto' => $produto, 'metodo' => $metodo, 'nome' => $nome, 'email' => $email);
        if ($documento !== '') {
            $out['documento'] = $documento;
        }
        $meta = os_field($o, 'metadata');
        $clean = array();
        foreach (OS_METADATA_KEYS as $key) {
            $value = os_text(os_field($meta, $key));
            if ($value === null) {
                continue;
            }
            $value = trim($value);
            if ($value === '' || os_len($value) < 0) {
                continue;
            }
            $clean[$key] = os_cut($value, 500);
        }
        $out['metadata'] = $clean;
        return $out;
    }
    $pedido = os_text(os_field($o, 'pedido'));
    if ($pedido === null || !preg_match('/^[A-Za-z0-9_-]{3,100}$/', $pedido)) {
        return null;
    }
    if ($acao === 'status') {
        $produto = os_text(os_field($o, 'produto'));
        if ($produto === null || !preg_match(OS_PRODUCT_RE, $produto)) {
            return null;
        }
        return array('acao' => 'status', 'pedido' => $pedido, 'produto' => $produto);
    }
    if ($acao === 'acesso') {
        $produto = os_field($o, 'produto');
        if ($produto === null || $produto === '') {
            return array('acao' => 'acesso', 'pedido' => $pedido, 'produto' => null);
        }
        if (!is_string($produto) || !preg_match(OS_PRODUCT_RE, $produto)) {
            return null;
        }
        return array('acao' => 'acesso', 'pedido' => $pedido, 'produto' => $produto);
    }
    if ($acao === 'simular') {
        // Só existe na prévia do Offer Studio: aqui é recusado.
        return array('acao' => 'simular');
    }
    return null;
}

/** Pasta gravável para os limites por IP (pagamento-dados/limites; senão a temporária; null = sem limite). */
function os_limit_dir()
{
    $dir = __DIR__ . '/' . OS_DATA_DIR . '/limites';
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    if (is_dir($dir) && @is_writable($dir)) {
        return array($dir, '');
    }
    $tmp = function_exists('sys_get_temp_dir') ? sys_get_temp_dir() : '';
    return $tmp && @is_writable($tmp) ? array(rtrim($tmp, '/\\'), 'os-pagamento-') : null;
}

/**
 * Quem conta nos limites: IPv4 exato; IPv6 pelo /64 ($bits = 64) ou pela
 * rede /48 — um só cliente recebe o /64 inteiro (2^64 endereços), contar o
 * endereço exato não limitaria ninguém.
 */
function os_rate_key($ip, $bits)
{
    $bin = @inet_pton((string) $ip);
    if ($bin === false || strlen($bin) !== 16) {
        return (string) $ip;
    }
    return 'v6:' . bin2hex(substr($bin, 0, intdiv($bits, 8))) . '/' . $bits;
}

/**
 * Conta mais um pedido de $who em $bucket nesta janela de tempo e devolve
 * quantos já foram (0 = sem limite: a pasta não aceita gravação). Os arquivos
 * guardam só um resumo (md5) e começam com "<?php exit; ?>": abertos pelo
 * navegador, não mostram nada.
 */
function os_rate_hit($bucket, $who)
{
    $where = os_limit_dir();
    if ($where === null) {
        return 0;
    }
    $key = md5(__DIR__ . '|' . $bucket . '|' . $who);
    $file = $where[0] . '/' . $where[1] . $bucket . '-' . substr($key, 0, 2) . '.php';
    $handle = @fopen($file, 'c+');
    if (!$handle) {
        return 0;
    }
    $count = 0;
    if (@flock($handle, LOCK_EX)) {
        $window = (int) floor(time() / OS_WINDOW);
        $raw = (string) stream_get_contents($handle);
        $data = json_decode((string) substr($raw, strlen(OS_LIMIT_HEAD)), true);
        if (!is_array($data) || !isset($data['w']) || (int) $data['w'] !== $window || !isset($data['c']) || !is_array($data['c'])) {
            $data = array('w' => $window, 'c' => array());
        }
        $count = isset($data['c'][$key]) ? (int) $data['c'][$key] + 1 : 1;
        $data['c'][$key] = $count;
        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, OS_LIMIT_HEAD . json_encode($data));
        fflush($handle);
        flock($handle, LOCK_UN);
    }
    fclose($handle);
    return $count;
}

/** Mais um pedido de $who em $bucket; false = passou do limite. */
function os_rate_ok($bucket, $who, $limit)
{
    return os_rate_hit($bucket, $who) <= $limit;
}

/** Um pedido HTTP (cURL; sem ele, allow_url_fopen). Devolve array(status, corpo); status 0 = sem resposta. */
function os_http($method, $url, $headers, $payload)
{
    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        if ($curl === false) {
            return array(0, '');
        }
        $options = array(
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => OS_TIMEOUT,
            CURLOPT_FOLLOWLOCATION => false,
        );
        if ($payload !== null) {
            $options[CURLOPT_POSTFIELDS] = $payload;
        }
        curl_setopt_array($curl, $options);
        $raw = curl_exec($curl);
        $status = $raw === false ? 0 : (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        // PHP 8+: o cURL fecha sozinho (curl_close é obsoleto no 8.5).
        if (PHP_VERSION_ID < 80000) {
            curl_close($curl);
        }
        return array($status, $raw === false ? '' : (string) $raw);
    }
    if (!ini_get('allow_url_fopen')) {
        return array(0, '');
    }
    $context = stream_context_create(array('http' => array(
        'method' => $method,
        'header' => implode("\r\n", $headers),
        'content' => $payload === null ? '' : $payload,
        'timeout' => OS_TIMEOUT,
        'ignore_errors' => true,
        'follow_location' => 0,
    )));
    $raw = @file_get_contents($url, false, $context);
    $status = 0;
    if ($raw !== false && isset($http_response_header) && is_array($http_response_header)) {
        foreach ($http_response_header as $line) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m)) {
                $status = (int) $m[1];
            }
        }
    }
    return array($status, $raw === false ? '' : (string) $raw);
}

/**
 * Pedido à API da Kyvo. Sem resposta, 429 ou 5xx: tenta mais uma vez (a
 * criação leva a Idempotency-Key = pedido: repetir nunca cobra duas vezes).
 */
function os_kyvo($method, $path, $apiKey, $body)
{
    $headers = array('Authorization: Bearer ' . $apiKey, 'Accept: application/json');
    $payload = null;
    if ($body !== null) {
        $payload = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($payload === false) {
            return array(0, '');
        }
        $headers[] = 'Content-Type: application/json';
        if (isset($body['externalOrderId'])) {
            $headers[] = 'Idempotency-Key: ' . $body['externalOrderId'];
        }
    }
    $res = array(0, '');
    for ($try = 0; $try < 2; $try++) {
        if ($try > 0) {
            usleep(700000);
        }
        $res = os_http($method, OS_API . $path, $headers, $payload);
        if ($res[0] !== 0 && $res[0] !== 429 && $res[0] < 500) {
            break;
        }
    }
    return $res;
}

/** Erro da Kyvo → código do contrato (a mensagem dela nunca vai para a página). */
function os_gateway_error($status, $raw)
{
    $json = json_decode((string) $raw, true);
    $error = os_field($json, 'error');
    $code = (string) os_text(os_field($error, 'code'));
    if ($status === 402 || $code === 'payment_declined') {
        return 'recusado';
    }
    if ($status === 401 || $status === 403) {
        return 'configuracao';
    }
    if ($status === 404) {
        return 'nao_encontrado';
    }
    if ($status === 400 || $status === 422) {
        return preg_match('/^(amount_|currency_|only_methods_)/', $code) ? 'configuracao' : 'invalido';
    }
    return 'indisponivel';
}

/** Transação da Kyvo (GET /v1/transactions/{id}); erro → responde e termina. */
function os_transaction($apiKey, $id)
{
    $res = os_kyvo('GET', '/v1/transactions/' . rawurlencode($id), $apiKey, null);
    if ($res[0] < 200 || $res[0] >= 300) {
        os_fail(os_gateway_error($res[0], $res[1]));
    }
    $tx = json_decode($res[1], true);
    if (!is_array($tx) || os_field($tx, 'id') !== $id || !in_array(os_field($tx, 'status'), OS_STATUSES, true)) {
        os_fail('indisponivel');
    }
    return $tx;
}

/** Código do produto de um pedido do Offer Studio (os_<código>_<20>); null = não é daqui. */
function os_order_code($external)
{
    return is_string($external) && preg_match('/^os_([a-z0-9-]{1,32})_[a-z0-9]{20}$/', $external, $m) ? $m[1] : null;
}

/** Pedido novo: os_<código do produto>_<20 letras/números aleatórios>. */
function os_new_order($code)
{
    $alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
    $out = '';
    while (strlen($out) < 20) {
        foreach (str_split(random_bytes(32)) as $char) {
            $byte = ord($char);
            // 252 = 7 × 36: descarta o resto para não favorecer letras.
            if ($byte < 252 && strlen($out) < 20) {
                $out .= $alphabet[$byte % 36];
            }
        }
    }
    return 'os_' . $code . '_' . $out;
}

/** Produto pronto para vender (valor, moeda, código e métodos no formato certo)? */
function os_product_ok($product)
{
    return is_array($product)
        && isset($product['codigo'], $product['valor'], $product['moeda'], $product['metodos'])
        && is_string($product['codigo']) && preg_match('/^[a-z0-9-]{1,32}$/', $product['codigo'])
        && is_int($product['valor']) && $product['valor'] > 0
        && is_string($product['moeda']) && is_array($product['metodos']);
}

/** O método está ligado no produto e aceita a moeda dele? */
function os_method_ok($product, $method)
{
    $currencies = array(${METHOD_CURRENCIES_PHP});
    return in_array($method, $product['metodos'], true)
        && isset($currencies[$method]) && in_array($product['moeda'], $currencies[$method], true);
}

/**
 * Endereço da página de onde veio o pedido (só deste site), ou null. Sem a
 * query nem o fragmento: IDs de clique (fbclid, ttclid, gclid…) e dados
 * pessoais do endereço (email, phone…) não vão à Kyvo sem permissão — as
 * UTMs e o src já seguem na metadata filtrada.
 */
function os_source_url($host)
{
    $referer = isset($_SERVER['HTTP_REFERER']) ? (string) $_SERVER['HTTP_REFERER'] : '';
    if ($referer === '' || strlen($referer) > 2000 || !preg_match('#^https?://#i', $referer) || os_host_of($referer) !== $host) {
        return null;
    }
    return substr($referer, 0, strcspn($referer, '?#'));
}

function os_https()
{
    if (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') {
        return true;
    }
    if (isset($_SERVER['SERVER_PORT']) && (int) $_SERVER['SERVER_PORT'] === 443) {
        return true;
    }
    return isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower((string) $_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https';
}

$config = @include __DIR__ . '/' . OS_DATA_DIR . '/config.php';
if (!is_array($config)) {
    $config = array();
}
$apiKey = trim((string) os_text(os_field($config, 'chave')));
$products = is_array(os_field($config, 'produtos')) ? $config['produtos'] : array();
$trustProxy = os_field($config, 'trust_proxy') === true;

$method = isset($_SERVER['REQUEST_METHOD']) ? strtoupper((string) $_SERVER['REQUEST_METHOD']) : '';

// Aberto no navegador: mostra se está funcionando (sem a chave nem os links de acesso).
if ($method === 'GET' || $method === 'HEAD') {
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex');
    $send = function_exists('curl_init') ? 'cURL' : (ini_get('allow_url_fopen') ? 'allow_url_fopen' : 'INDISPONÍVEL (peça à hospedagem para ativar o cURL)');
    $limits = os_limit_dir();
    echo "pagamento.php do Offer Studio funcionando.\n";
    echo 'PHP ' . PHP_VERSION . ' · conexão com a Kyvo: ' . $send . "\n";
    echo 'Chave da Kyvo: ' . ($apiKey !== '' ? 'cadastrada' : 'FALTANDO (cadastre em Configurações → Pagamentos no Offer Studio e gere o ZIP de novo)') . "\n";
    echo 'Produtos: ' . count($products) . "\n";
    echo 'HTTPS: ' . (os_https() ? 'sim' : 'NÃO (o pagamento precisa do site em https://)') . "\n";
    echo 'Limite por IP: ' . ($limits !== null ? 'ligado' : 'desligado (a pasta pagamento-dados não aceita gravação)') . "\n";
    exit;
}
if ($method !== 'POST') {
    header('Allow: GET, POST');
    os_fail('invalido');
}

// Só da própria página (mesmo site): o navegador sempre manda Origin num POST
// ou o Referer; sem nenhum dos dois, não é a página. "Origin: null" (iframe
// sandbox de outro site, sem Referer) também não: a janela de pagamento pede
// com referrerPolicy "same-origin", então a página de verdade manda a origem.
$host = strtolower(preg_replace('/:\d+$/', '', isset($_SERVER['HTTP_HOST']) ? (string) $_SERVER['HTTP_HOST'] : ''));
if (!isset($_SERVER['HTTP_ORIGIN']) && empty($_SERVER['HTTP_REFERER'])) {
    os_fail('origem');
}
if (isset($_SERVER['HTTP_ORIGIN']) && trim((string) $_SERVER['HTTP_ORIGIN']) === 'null') {
    os_fail('origem');
}
$origin = '';
if (!empty($_SERVER['HTTP_ORIGIN']) && $_SERVER['HTTP_ORIGIN'] !== 'null') {
    $origin = (string) $_SERVER['HTTP_ORIGIN'];
} elseif (!empty($_SERVER['HTTP_REFERER'])) {
    $origin = (string) $_SERVER['HTTP_REFERER'];
}
if ($origin !== '' && ($host === '' || os_host_of($origin) !== $host)) {
    os_fail('origem');
}

$type = isset($_SERVER['CONTENT_TYPE']) ? strtolower((string) $_SERVER['CONTENT_TYPE']) : '';
if ($type !== '' && strpos($type, 'application/json') !== 0 && strpos($type, 'text/plain') !== 0) {
    os_fail('invalido');
}
if (isset($_SERVER['CONTENT_LENGTH']) && (int) $_SERVER['CONTENT_LENGTH'] > OS_MAX_BODY) {
    os_fail('corpo_grande');
}
$raw = file_get_contents('php://input', false, null, 0, OS_MAX_BODY + 1);
if (!is_string($raw) || $raw === '') {
    os_fail('invalido');
}
if (strlen($raw) > OS_MAX_BODY) {
    os_fail('corpo_grande');
}
$req = os_parse(json_decode($raw, true));
if ($req === null || $req['acao'] === 'simular') {
    os_fail('invalido');
}

$ip = os_client_ip($trustProxy);

if ($req['acao'] === 'criar') {
    $key = $req['produto'];
    $product = isset($products[$key]) ? $products[$key] : null;
    if (!is_array($product)) {
        os_fail('produto_desconhecido');
    }
    if (!os_product_ok($product)) {
        os_fail('configuracao');
    }
    if (!os_method_ok($product, $req['metodo'])) {
        os_fail('metodo_indisponivel');
    }
    // Sem a chave ou sem o link de acesso, não cobra: quem pagasse não receberia o produto.
    if ($apiKey === '' || trim((string) os_text(os_field($product, 'acesso'))) === '') {
        os_fail('configuracao');
    }
    // Limites: por IP (IPv6 por /64), por rede IPv6 /48 e, para cartão, por
    // e-mail. O teto do site só conta as cobranças além das primeiras de cada
    // IP: quem chega para comprar nunca é barrado por um ataque de outros IPs.
    $mine = os_rate_hit('criar', os_rate_key($ip, 64));
    if ($mine > OS_CREATE_LIMIT) {
        os_fail('limite');
    }
    if (os_rate_key($ip, 48) !== $ip && !os_rate_ok('criar-rede', os_rate_key($ip, 48), OS_CREATE_NET_LIMIT)) {
        os_fail('limite');
    }
    if ($req['metodo'] !== 'spei' && !os_rate_ok('criar-email', $req['email'], OS_CARD_EMAIL_LIMIT)) {
        os_fail('limite');
    }
    if ($mine > OS_CREATE_FREE && !os_rate_ok('criar-site', '*', OS_CREATE_TOTAL)) {
        os_fail('limite');
    }

    $external = os_new_order($product['codigo']);
    $customer = array('name' => $req['nome'], 'email' => $req['email']);
    if (isset($req['documento'])) {
        $customer['document'] = $req['documento'];
    }
    $metadata = $req['metadata'];
    if ($ip !== '') {
        $metadata['ip'] = $ip;
    }
    $agent = isset($_SERVER['HTTP_USER_AGENT']) ? (string) $_SERVER['HTTP_USER_AGENT'] : '';
    if ($agent !== '' && os_len($agent) >= 0) {
        $metadata['ua'] = os_cut($agent, 500);
    }
    $body = array('amount' => $product['valor'], 'customer' => $customer, 'externalOrderId' => $external);
    $source = os_source_url($host);
    if ($source !== null) {
        $body['sourceUrl'] = $source;
    }
    if (count($metadata)) {
        $body['metadata'] = $metadata;
    }
    if ($req['metodo'] === 'spei') {
        $path = '/v1/spei/charges';
    } else {
        $path = '/v1/card/charges';
        $body['currency'] = $product['moeda'];
        if ($req['metodo'] === 'bizum' || $req['metodo'] === 'mb_way') {
            $body['onlyMethods'] = array($req['metodo']);
        }
    }

    $res = os_kyvo('POST', $path, $apiKey, $body);
    if ($res[0] < 200 || $res[0] >= 300) {
        os_fail(os_gateway_error($res[0], $res[1]));
    }
    $charge = json_decode($res[1], true);
    $id = os_text(os_field($charge, 'id'));
    $status = os_field($charge, 'status');
    if ($id === null || !preg_match('/^[A-Za-z0-9_-]{3,100}$/', $id) || !in_array($status, OS_STATUSES, true)) {
        os_fail('indisponivel');
    }
    $instructions = os_field($charge, 'instructions');
    $out = array(
        'ok' => true,
        'pedido' => $id,
        'pedidoExterno' => $external,
        'status' => $status,
        'valor' => $product['valor'],
        'moeda' => $product['moeda'],
        'metodo' => $req['metodo'],
    );
    if ($req['metodo'] === 'spei') {
        $spei = os_field($instructions, 'spei');
        $clabe = (string) os_text(os_field($spei, 'clabe'));
        if (os_field($instructions, 'method') !== 'spei' || $clabe === '') {
            os_fail('indisponivel');
        }
        $holder = (string) os_text(os_field($spei, 'nominal'));
        $expires = (string) os_text(os_field($spei, 'expires_at'));
        $out['spei'] = array(
            'clabe' => $clabe,
            'banco' => (string) os_text(os_field($spei, 'bank')),
            'titular' => $holder !== '' ? $holder : (string) os_text(os_field($spei, 'beneficiary')),
            'referencia' => (string) os_text(os_field($spei, 'reference')),
            'expiraEm' => $expires !== '' ? $expires : null,
        );
    } else {
        // A sessão vai para o SDK exatamente como veio (objetos continuam objetos).
        $raw = json_decode($res[1]);
        $card = isset($raw->instructions->card) && is_object($raw->instructions->card) ? $raw->instructions->card : null;
        $sdk = $card !== null && isset($card->sdk_url) && is_string($card->sdk_url) ? $card->sdk_url : '';
        if (os_field($instructions, 'method') !== 'card' || !preg_match(OS_SDK_RE, $sdk) || !isset($card->session) || !is_object($card->session)) {
            os_fail('indisponivel');
        }
        $out['cartao'] = array(
            'sdkUrl' => $sdk,
            'sessao' => $card->session,
            'expiraEm' => isset($card->expires_at) && is_string($card->expires_at) && $card->expires_at !== '' ? $card->expires_at : null,
        );
    }
    os_reply(201, $out);
}

// status e acesso: consultas (limite folgado por IP: a janela confere a cada ~4 s).
if (!os_rate_ok('consulta', os_rate_key($ip, 64), OS_READ_LIMIT)) {
    os_fail('limite');
}
if ($apiKey === '') {
    os_fail('configuracao');
}

if ($req['acao'] === 'status') {
    $product = isset($products[$req['produto']]) ? $products[$req['produto']] : null;
    if (!os_product_ok($product)) {
        os_fail('nao_encontrado');
    }
    $tx = os_transaction($apiKey, $req['pedido']);
    $external = os_field($tx, 'externalOrderId');
    // Só pedidos deste produto criados por este site (nada de consultar outras vendas da conta).
    if (os_order_code($external) !== $product['codigo']) {
        os_fail('nao_encontrado');
    }
    os_reply(200, array(
        'ok' => true,
        'pedido' => $req['pedido'],
        'status' => $tx['status'],
        'pago' => $tx['status'] === 'paid',
        'pedidoExterno' => $external,
        'valor' => $product['valor'],
        'moeda' => $product['moeda'],
    ));
}

// acesso: o produto vem do pedido (externalOrderId lido da Kyvo), nunca do navegador.
$tx = os_transaction($apiKey, $req['pedido']);
$code = os_order_code(os_field($tx, 'externalOrderId'));
$found = null;
if ($code !== null) {
    foreach ($products as $key => $product) {
        if (os_product_ok($product) && $product['codigo'] === $code) {
            $found = array((string) $key, $product);
            break;
        }
    }
}
if ($found === null || ($req['produto'] !== null && $req['produto'] !== $found[0])) {
    os_fail('nao_encontrado');
}
if ($tx['status'] === 'pending') {
    os_fail('pendente');
}
if ($tx['status'] !== 'paid') {
    os_fail('nao_pago');
}
$access = trim((string) os_text(os_field($found[1], 'acesso')));
if ($access === '') {
    os_fail('configuracao');
}
os_reply(200, array('ok' => true, 'pedido' => $req['pedido'], 'status' => 'paid', 'acesso' => $access, 'produto' => $found[0]));
`;
}
