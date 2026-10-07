/**
 * eventos.php do ZIP (opção serverEvents): API de Conversões da Meta e Events
 * API do TikTok pelo servidor da hospedagem (PHP 7.4+, sem dependências).
 *
 * - eventos.php: o código (igual em todo ZIP, sem nenhum segredo). Recebe o
 *   POST do script das páginas (navigator.sendBeacon: JSON como text/plain, no
 *   formato de docs/PLANO.md), confere tamanho (até 8 KB), origem (mesmo site;
 *   sem Origin nem Referer, recusa — navegador sempre manda um dos dois),
 *   formato de cada campo e um limite por IP; responde 204 na hora e só então
 *   repassa para as plataformas com o IP e o navegador do visitante (tempo
 *   curto, nunca mostra token nem erro das plataformas). Aberto no navegador
 *   (GET), mostra se está funcionando — sem segredos.
 * - eventos-dados/config.php: os tokens, num array PHP (nunca impresso).
 *   Aberto direto, responde 404; o eventos-dados/.htaccess ainda bloqueia o
 *   acesso no Apache. Fica numa pasta própria para o ZIP nunca trazer um
 *   .htaccess na raiz (ele substituiria o da hospedagem: HTTPS, WordPress…).
 * - IP do visitante: o da conexão (REMOTE_ADDR). Os cabeçalhos de proxy só
 *   valem quando a conexão vem da Cloudflare (CF-Connecting-IP; faixas de IP
 *   publicadas por ela) ou com 'trust_proxy' => true no config.php (outro CDN
 *   na frente do site). Assim ninguém escolhe o IP que vai para a Meta nem
 *   escapa do limite por IP trocando um cabeçalho.
 *
 * O endereço é público por natureza (o script das páginas chama ele), como o
 * pixel do navegador: qualquer um consegue mandar um evento falso, e isso não
 * é autenticação. O limite por IP e as conferências só evitam abuso fácil.
 *
 * ATENÇÃO: numa hospedagem sem PHP (só arquivos estáticos), o config.php
 * seria entregue como texto, com os tokens. O LEIA-ME.txt e o painel avisam.
 */
import type { ServerEventVendor } from "./options";

export const EVENTOS_FILE = "eventos.php";
/** Pasta dos tokens (com o .htaccess dela): nada do ZIP fica na raiz além do eventos.php. */
export const EVENTOS_CONFIG_DIR = "eventos-dados/";
export const EVENTOS_CONFIG_FILE = `${EVENTOS_CONFIG_DIR}config.php`;
export const HTACCESS_FILE = `${EVENTOS_CONFIG_DIR}.htaccess`;

/** Tamanho máximo do corpo aceito pelo eventos.php (o script manda bem menos). */
export const EVENTOS_MAX_BODY = 8192;
/**
 * Eventos por minuto por IP (acima disso, 429). Folgado: no celular, muita
 * gente sai pelo mesmo IP da operadora.
 */
export const EVENTOS_RATE_LIMIT = 600;

/**
 * Faixas de IP da Cloudflare (https://www.cloudflare.com/ips/): conexões
 * vindas delas trazem o IP do visitante em CF-Connecting-IP.
 */
export const CLOUDFLARE_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
] as const;
/** Versão da Graph API da Meta usada pelo eventos.php. */
export const META_GRAPH_VERSION = "v21.0";
export const META_EVENTS_URL = (pixelId: string) =>
  `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(pixelId)}/events`;
export const TIKTOK_EVENTS_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

export interface ServerEventPixel {
  vendor: ServerEventVendor;
  pixelId: string;
  token: string;
  testEventCode: string | null;
}

/** Texto seguro entre aspas simples do PHP (sem quebras de linha nem caracteres de controle). */
export function phpString(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: tira caracteres de controle do token
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, "");
  return `'${clean.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function pixelEntries(pixels: ServerEventPixel[], vendor: ServerEventVendor): string {
  const rows = pixels
    .filter((p) => p.vendor === vendor)
    .map(
      (p) =>
        `    array('pixel' => ${phpString(p.pixelId)}, 'token' => ${phpString(p.token)}, 'test_event_code' => ${phpString(p.testEventCode ?? "")}),`,
    );
  return rows.length ? `array(\n${rows.join("\n")}\n  )` : "array()";
}

/** eventos-dados/config.php com os tokens (só no ZIP; nunca vai para o HTML). */
export function eventosConfigPhp(pixels: ServerEventPixel[]): string {
  return `<?php
// Offer Studio — tokens da API de Conversões (Meta) e da Events API (TikTok).
// Usado pelo eventos.php. NÃO compartilhe este arquivo: quem tiver os tokens
// consegue mandar eventos em nome dos seus pixels.
// Só funciona em hospedagem com PHP (veja o LEIA-ME.txt).
if (!defined('OS_EVENTOS')) {
  http_response_code(404);
  exit;
}

return array(
  'meta' => ${pixelEntries(pixels, "META")},
  'tiktok' => ${pixelEntries(pixels, "TIKTOK")},
  // true só se o site fica atrás de um CDN/proxy que não seja a Cloudflare
  // (a Cloudflare já é reconhecida): aí o IP do visitante vem do cabeçalho
  // X-Forwarded-For. Deixe false se não tiver certeza.
  'trust_proxy' => false,
);
`;
}

/**
 * eventos-dados/.htaccess (Apache/LiteSpeed: Hostinger, HostGator, cPanel):
 * bloqueia o config.php. Vale só para a pasta dos tokens (nunca mexe no
 * .htaccess da raiz da hospedagem).
 */
export function htaccess(): string {
  return `# Offer Studio: o arquivo com os tokens do eventos.php não pode ser aberto pelo navegador.
<Files "config.php">
  <IfModule mod_authz_core.c>
    Require all denied
  </IfModule>
  <IfModule !mod_authz_core.c>
    Order allow,deny
    Deny from all
  </IfModule>
</Files>
`;
}

/**
 * Funções PHP do IP do visitante (faixas da Cloudflare, trust_proxy): as mesmas
 * no eventos.php e no pagamento.php (src/lib/export/payment-php.ts).
 */
export const PHP_CLIENT_IP_FUNCTIONS = `/** O IP está na faixa (CIDR, IPv4 ou IPv6)? */
function os_ip_in($ip, $cidr)
{
    $parts = explode('/', $cidr, 2);
    $ipBin = @inet_pton($ip);
    $netBin = @inet_pton($parts[0]);
    if ($ipBin === false || $netBin === false || strlen($ipBin) !== strlen($netBin)) {
        return false;
    }
    $bits = isset($parts[1]) ? (int) $parts[1] : strlen($ipBin) * 8;
    $bytes = intdiv($bits, 8);
    if ($bytes > 0 && substr($ipBin, 0, $bytes) !== substr($netBin, 0, $bytes)) {
        return false;
    }
    $rest = $bits % 8;
    if ($rest === 0) {
        return true;
    }
    $mask = (0xff << (8 - $rest)) & 0xff;
    return (ord($ipBin[$bytes]) & $mask) === (ord($netBin[$bytes]) & $mask);
}

/** A conexão vem da Cloudflare (faixas publicadas por ela)? */
function os_from_cloudflare($remote)
{
    foreach (array(${CLOUDFLARE_RANGES.map((r) => `'${r}'`).join(", ")}) as $range) {
        if (os_ip_in($remote, $range)) {
            return true;
        }
    }
    return false;
}

function os_public_ip($ip)
{
    $ip = trim((string) $ip);
    return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) ? $ip : null;
}

/**
 * IP do visitante: o da conexão (REMOTE_ADDR). Cabeçalhos de proxy só valem
 * quando a conexão vem da Cloudflare (CF-Connecting-IP) ou com trust_proxy
 * (X-Forwarded-For, X-Real-IP): senão qualquer um escolheria o IP.
 */
function os_client_ip($trustProxy)
{
    $remote = isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '';
    if (!filter_var($remote, FILTER_VALIDATE_IP)) {
        $remote = '';
    }
    if ($remote !== '' && !empty($_SERVER['HTTP_CF_CONNECTING_IP']) && os_from_cloudflare($remote)) {
        $ip = os_public_ip($_SERVER['HTTP_CF_CONNECTING_IP']);
        if ($ip !== null) {
            return $ip;
        }
    }
    if ($trustProxy) {
        $candidates = array();
        if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
            $candidates = explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR']);
        }
        if (!empty($_SERVER['HTTP_X_REAL_IP'])) {
            $candidates[] = $_SERVER['HTTP_X_REAL_IP'];
        }
        foreach ($candidates as $candidate) {
            $ip = os_public_ip($candidate);
            if ($ip !== null) {
                return $ip;
            }
        }
    }
    return $remote;
}

`;

/** eventos.php (PHP 7.4+). Não tem segredos: lê os tokens do eventos-dados/config.php. */
export function eventosPhp(): string {
  return `<?php
/**
 * Offer Studio — eventos.php
 *
 * Recebe os eventos das páginas desta oferta e repassa para a API de Conversões
 * da Meta e para a Events API do TikTok, com o IP e o navegador do visitante
 * (os pixels no navegador mandam o mesmo evento com o mesmo event_id, e as
 * plataformas juntam os dois). Os tokens ficam em eventos-dados/config.php.
 *
 * Requer PHP 7.4 ou mais novo (com cURL ou allow_url_fopen).
 * Teste: abra https://seusite.com/eventos.php no navegador.
 */

define('OS_EVENTOS', 1);
error_reporting(0);
@ini_set('display_errors', '0');

const OS_MAX_BODY = ${EVENTOS_MAX_BODY};
const OS_RATE_LIMIT = ${EVENTOS_RATE_LIMIT};
const OS_META_URL = 'https://graph.facebook.com/${META_GRAPH_VERSION}/';
const OS_TIKTOK_URL = '${TIKTOK_EVENTS_URL}';

/** Responde sem corpo e termina. */
function os_end($status)
{
    http_response_code($status);
    header('Cache-Control: no-store');
    header('Content-Length: 0');
    exit;
}

/** Texto (ou número) aparado, com limite de tamanho e formato; null quando não serve. */
function os_str($value, $max, $pattern = null)
{
    if (!is_string($value) && !is_int($value) && !is_float($value)) {
        return null;
    }
    $value = trim((string) $value);
    if ($value === '' || strlen($value) > $max) {
        return null;
    }
    if ($pattern !== null && !preg_match($pattern, $value)) {
        return null;
    }
    return $value;
}

function os_filled($value)
{
    return $value !== null && $value !== '';
}

/** Host de um endereço, em minúsculas ('' quando não tem). */
function os_host_of($url)
{
    $host = parse_url((string) $url, PHP_URL_HOST);
    return is_string($host) ? strtolower($host) : '';
}

${PHP_CLIENT_IP_FUNCTIONS}/** Limite leve por IP (arquivo temporário; sem pasta temporária gravável, não limita). */
function os_rate_ok($ip)
{
    $dir = function_exists('sys_get_temp_dir') ? sys_get_temp_dir() : '';
    if (!$dir || !@is_writable($dir)) {
        return true;
    }
    $key = md5(__DIR__ . '|' . $ip);
    $file = rtrim($dir, '/\\\\') . '/os-eventos-' . substr($key, 0, 2) . '.json';
    $handle = @fopen($file, 'c+');
    if (!$handle) {
        return true;
    }
    $ok = true;
    if (@flock($handle, LOCK_EX)) {
        $window = (int) floor(time() / 60);
        $data = json_decode((string) stream_get_contents($handle), true);
        if (!is_array($data) || !isset($data['w']) || (int) $data['w'] !== $window || !isset($data['c']) || !is_array($data['c'])) {
            $data = array('w' => $window, 'c' => array());
        }
        $count = isset($data['c'][$key]) ? (int) $data['c'][$key] + 1 : 1;
        $data['c'][$key] = $count;
        $ok = $count <= OS_RATE_LIMIT;
        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, json_encode($data));
        fflush($handle);
        flock($handle, LOCK_UN);
    }
    fclose($handle);
    return $ok;
}

/** POST com tempo curto; a resposta das plataformas é ignorada (nunca aparece). */
function os_post($url, $body, $headers)
{
    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        if ($curl === false) {
            return;
        }
        curl_setopt_array($curl, array(
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_TIMEOUT => 4,
            CURLOPT_FOLLOWLOCATION => false,
        ));
        curl_exec($curl);
        // PHP 8+: o cURL fecha sozinho (curl_close é obsoleto no 8.5).
        if (PHP_VERSION_ID < 80000) {
            curl_close($curl);
        }
        return;
    }
    $context = stream_context_create(array('http' => array(
        'method' => 'POST',
        'header' => implode("\\r\\n", $headers),
        'content' => $body,
        'timeout' => 4,
        'ignore_errors' => true,
    )));
    @file_get_contents($url, false, $context);
}

function os_json($data)
{
    return json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
}

$config = @include __DIR__ . '/${EVENTOS_CONFIG_FILE}';
if (!is_array($config)) {
    $config = array();
}
$metaPixels = isset($config['meta']) && is_array($config['meta']) ? $config['meta'] : array();
$tiktokPixels = isset($config['tiktok']) && is_array($config['tiktok']) ? $config['tiktok'] : array();
$trustProxy = isset($config['trust_proxy']) && $config['trust_proxy'] === true;

$method = isset($_SERVER['REQUEST_METHOD']) ? strtoupper((string) $_SERVER['REQUEST_METHOD']) : '';

// Aberto no navegador: mostra se está funcionando (sem tokens).
if ($method === 'GET' || $method === 'HEAD') {
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Robots-Tag: noindex');
    echo "eventos.php do Offer Studio funcionando.\\n";
    echo 'PHP ' . PHP_VERSION . ' · envio: ' . (function_exists('curl_init') ? 'cURL' : (ini_get('allow_url_fopen') ? 'allow_url_fopen' : 'INDISPONÍVEL (peça à hospedagem para ativar o cURL)')) . "\\n";
    echo 'Meta (API de Conversões): ' . count($metaPixels) . ' pixel(s) · TikTok (Events API): ' . count($tiktokPixels) . " pixel(s)\\n";
    exit;
}
if ($method !== 'POST') {
    header('Allow: GET, POST');
    os_end(405);
}

// Só da própria página (mesmo site). O navegador sempre manda Origin num POST
// ("null" quando a página esconde a origem) ou o Referer: sem nenhum dos dois,
// não é o script das páginas.
$host = strtolower(preg_replace('/:\\d+$/', '', isset($_SERVER['HTTP_HOST']) ? (string) $_SERVER['HTTP_HOST'] : ''));
if (!isset($_SERVER['HTTP_ORIGIN']) && empty($_SERVER['HTTP_REFERER'])) {
    os_end(403);
}
$origin = '';
if (!empty($_SERVER['HTTP_ORIGIN']) && $_SERVER['HTTP_ORIGIN'] !== 'null') {
    $origin = (string) $_SERVER['HTTP_ORIGIN'];
} elseif (!empty($_SERVER['HTTP_REFERER'])) {
    $origin = (string) $_SERVER['HTTP_REFERER'];
}
if ($origin !== '' && ($host === '' || os_host_of($origin) !== $host)) {
    os_end(403);
}

$type = isset($_SERVER['CONTENT_TYPE']) ? strtolower((string) $_SERVER['CONTENT_TYPE']) : '';
if ($type !== '' && strpos($type, 'text/plain') !== 0 && strpos($type, 'application/json') !== 0) {
    os_end(415);
}
if (isset($_SERVER['CONTENT_LENGTH']) && (int) $_SERVER['CONTENT_LENGTH'] > OS_MAX_BODY) {
    os_end(413);
}
$raw = file_get_contents('php://input', false, null, 0, OS_MAX_BODY + 1);
if (!is_string($raw) || $raw === '') {
    os_end(400);
}
if (strlen($raw) > OS_MAX_BODY) {
    os_end(413);
}
$input = json_decode($raw, true);
if (!is_array($input)) {
    os_end(400);
}

$ip = os_client_ip($trustProxy);
if (!os_rate_ok($ip)) {
    os_end(429);
}

$eventId = os_str(isset($input['event_id']) ? $input['event_id'] : null, 100, '/^[A-Za-z0-9_.:-]+$/');
if ($eventId === null) {
    os_end(400);
}
$names = isset($input['event_name']) && is_array($input['event_name']) ? $input['event_name'] : array();
$metaName = os_str(isset($names['META']) ? $names['META'] : null, 60, '/^[A-Za-z0-9_ ]+$/');
$tiktokName = os_str(isset($names['TIKTOK']) ? $names['TIKTOK'] : null, 60, '/^[A-Za-z0-9_ ]+$/');

$now = time();
$time = isset($input['event_time']) && is_numeric($input['event_time']) ? (int) $input['event_time'] : $now;
if ($time > $now + 60 || $time < $now - 7 * 86400) {
    $time = $now;
}

// Endereço da página: só deste site (senão, o Referer; senão, nenhum).
$url = os_str(isset($input['event_source_url']) ? $input['event_source_url'] : null, 2000, '#^https?://#i');
if ($url !== null && os_host_of($url) !== $host) {
    $url = null;
}
if ($url === null && !empty($_SERVER['HTTP_REFERER'])) {
    $referer = os_str($_SERVER['HTTP_REFERER'], 2000, '#^https?://#i');
    $url = $referer !== null && os_host_of($referer) === $host ? $referer : null;
}

$value = null;
if (isset($input['value']) && is_numeric($input['value']) && $input['value'] >= 0 && $input['value'] <= 1000000) {
    $value = (float) $input['value'];
}
$currency = os_str(isset($input['currency']) ? $input['currency'] : null, 3, '/^[A-Z]{3}$/');
$fbp = os_str(isset($input['fbp']) ? $input['fbp'] : null, 200, '/^fb\\.\\d\\.\\d{10,13}\\.\\d{1,25}$/');
$fbc = os_str(isset($input['fbc']) ? $input['fbc'] : null, 600, '/^fb\\.\\d\\.\\d{10,13}\\.[A-Za-z0-9_.-]{1,500}$/');
$ttp = os_str(isset($input['ttp']) ? $input['ttp'] : null, 200, '/^[A-Za-z0-9_.-]+$/');
$ttclid = os_str(isset($input['ttclid']) ? $input['ttclid'] : null, 500, '/^[A-Za-z0-9_.-]+$/');
$userAgent = substr(isset($_SERVER['HTTP_USER_AGENT']) ? (string) $_SERVER['HTTP_USER_AGENT'] : '', 0, 512);

// custom_data (Meta) / properties (TikTok): valor e moeda e, no teste A/B, a versão.
$custom = array();
if ($value !== null && $currency !== null) {
    $custom = array('value' => $value, 'currency' => $currency);
}
// Teste A/B: a versão da página (os_versao) vai junto, como no pixel do navegador.
$version = os_str(isset($input['os_versao']) ? $input['os_versao'] : null, 20, '/^[A-Za-z0-9_-]+$/');
if ($version !== null) {
    $custom['os_versao'] = $version;
}

$requests = array();

if ($metaName !== null && count($metaPixels)) {
    $event = array(
        'event_name' => $metaName,
        'event_time' => $time,
        'event_id' => $eventId,
        'action_source' => 'website',
        'user_data' => array_filter(array(
            'client_ip_address' => $ip,
            'client_user_agent' => $userAgent,
            'fbp' => $fbp,
            'fbc' => $fbc,
        ), 'os_filled'),
    );
    if ($url !== null) {
        $event['event_source_url'] = $url;
    }
    if ($custom) {
        $event['custom_data'] = $custom;
    }
    foreach ($metaPixels as $pixel) {
        if (!is_array($pixel) || empty($pixel['pixel']) || empty($pixel['token'])) {
            continue;
        }
        $body = array('data' => array($event), 'access_token' => (string) $pixel['token']);
        if (!empty($pixel['test_event_code'])) {
            $body['test_event_code'] = (string) $pixel['test_event_code'];
        }
        $json = os_json($body);
        if ($json !== false) {
            $requests[] = array(OS_META_URL . rawurlencode((string) $pixel['pixel']) . '/events', $json, array('Content-Type: application/json'));
        }
    }
}

if ($tiktokName !== null && count($tiktokPixels)) {
    $event = array(
        'event' => $tiktokName,
        'event_time' => $time,
        'event_id' => $eventId,
        'user' => array_filter(array(
            'ttclid' => $ttclid,
            'ttp' => $ttp,
            'ip' => $ip,
            'user_agent' => $userAgent,
        ), 'os_filled'),
    );
    if ($url !== null) {
        $event['page'] = array('url' => $url);
    }
    if ($custom) {
        $event['properties'] = $custom;
    }
    foreach ($tiktokPixels as $pixel) {
        if (!is_array($pixel) || empty($pixel['pixel']) || empty($pixel['token'])) {
            continue;
        }
        $body = array('event_source' => 'web', 'event_source_id' => (string) $pixel['pixel'], 'data' => array($event));
        if (!empty($pixel['test_event_code'])) {
            $body['test_event_code'] = (string) $pixel['test_event_code'];
        }
        $json = os_json($body);
        $token = preg_replace('/[\\r\\n]/', '', (string) $pixel['token']);
        if ($json !== false) {
            $requests[] = array(OS_TIKTOK_URL, $json, array('Content-Type: application/json', 'Access-Token: ' . $token));
        }
    }
}

// Responde já (o navegador não espera) e só depois fala com as plataformas.
ignore_user_abort(true);
http_response_code(204);
header('Cache-Control: no-store');
header('Content-Length: 0');
header('Connection: close');
if (function_exists('fastcgi_finish_request')) {
    fastcgi_finish_request();
} elseif (function_exists('litespeed_finish_request')) {
    litespeed_finish_request();
} else {
    while (ob_get_level() > 0) {
        @ob_end_flush();
    }
    @flush();
}

foreach ($requests as $request) {
    os_post($request[0], $request[1], $request[2]);
}
exit;
`;
}
