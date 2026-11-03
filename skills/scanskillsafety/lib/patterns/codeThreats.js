"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanCodeThreats = scanCodeThreats;
// ABOUTME: Flags threats only code shows, for the script scan: decoded or downloaded code run, reverse shells, miners, setuid,
// ABOUTME: ransom notes, raw-IP and throwaway hosts, and the environment or credential files sent out. Not run over READMEs.
const scanInput_1 = require("../scanInput");
const exfiltration_1 = require("./exfiltration");
const suspiciousDownload_1 = require("./suspiciousDownload");
// Lines are matched in their normalized form: lower case, invisible characters and look-alikes removed.
const RUNS_DECODED_TEXT = [
    /\beval\s*\(\s*buffer\.from\([^)]*['"]base64['"]/,
    /\beval\s*\(\s*atob\s*\(/,
    /\bnew\s+function\s*\(\s*atob\s*\(/,
    /\b(exec|eval)\s*\(\s*(zlib\.decompress\s*\(\s*)?(base64\.b64decode|codecs\.decode|zlib\.decompress|marshal\.loads)\b/,
    /\b(powershell|pwsh)\b.*\s-(enc|encodedcommand|ec)\s+[a-z0-9+/=]{8,}/,
    /\b(iex|invoke-expression)\b.*frombase64string/,
];
// The download must sit inside the same statement as the eval, not anywhere later on a long minified line.
const RUNS_DOWNLOADED_CODE = /\b(exec|eval)\s*\([^;]{0,80}?\b(requests\.get|urlopen|urllib\.request|fetch\s*\(|https?\.get|axios\.get)/;
// Private keys and stored logins; a public key (.pub) or ~/.ssh/config is not a secret.
const CREDENTIAL_FILE = /\.ssh\/id_(rsa|dsa|ecdsa|ed25519)(?![\w.]*\.pub)\b|\.aws\/credentials|\.netrc\b|\.git-credentials|\.config\/gh\/hosts\.yml|\.docker\/config\.json|\.kube\/config\b|\.npmrc\b|\.pypirc\b/;
const SENDS_DATA = /\bcurl\b.*(\s-d(\s|@)|--data|\s-f\s|--form|\s-t\s|--upload-file|-x\s*post)|\bwget\b.*--post|\b(requests|httpx|axios)\.(post|put)\s*\(|method\s*:\s*['"]post|\bnc\s+[\w.-]+\s+\d+|urlopen\([^)]*data=|invoke-(webrequest|restmethod)\b.*-method\s+post/;
// A shell started interactively on a /dev/tcp connection, netcat handing a shell to a host, or (in a file that opens a socket
// and connects it) the socket wired to a shell's input and output. A /dev/tcp port probe or an os.dup2 to a log file is neither.
const REVERSE_SHELL = /\b(ba|z)?sh\s+-i\b.*\/dev\/tcp\/|\/dev\/tcp\/\S+\s+0>&1|\bnc(at)?\s+(-\w+\s+)*-e\s/;
const SOCKET_TO_SHELL = /\bos\.dup2\s*\(\s*\w+\.fileno\(\)|\bpty\.spawn\s*\(/;
const OPENS_SOCKET = /\bsocket\.socket\s*\(/;
const CONNECTS = /\.connect\s*\(/;
const MINER = /\bxmrig\b|stratum\+(tcp|ssl):\/\/|\bcryptonight\b|\bminerd\b|--donate-level\b/;
const SETUID = /\bchmod\s+([ug]+\+s\b|[2467][0-7]{3}\b)|\bos\.chmod\s*\([^)]*,\s*0o?[2467][0-7]{3}\b/;
const RANSOM_NOTE = /\byour (files|documents|data) (have been|are|were) encrypted\b/;
// A URL to a public raw IP address. Loopback, private, shared (carrier NAT and cloud metadata), link-local, unspecified and
// documentation addresses never leave the machine or are examples (as is 1.2.3.4), and the public DNS resolvers are services,
// not hosts anyone stages malware on.
const PUBLIC_IP_URL = /https?:\/\/(?!127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|(1\.1\.1\.1|1\.0\.0\.1|8\.8\.8\.8|8\.8\.4\.4|9\.9\.9\.9|1\.2\.3\.4)\b)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
// A host used as an address, in a URL or as what curl or wget fetches, and standing alone (or as a subdomain's parent): not
// part of a longer name (veil-transfer.sh), and not a name in a list, a search query or a message.
const ADDRESSED = "(?:https?:\\/\\/|(?<=\\b(?:curl|wget)\\b[^|;&\\n]*\\s))";
const hostPattern = (hosts) => new RegExp(`${ADDRESSED}(?:[a-z0-9-]+\\.)*(${hosts.map(escapeRegExp).join("|")})(?![a-z0-9-])`, "g");
// Request relays: data sent to one is collected by whoever made the address.
const RELAY_HOST = hostPattern(exfiltration_1.KNOWN_RELAY_DOMAINS);
// Paste sites and anonymous file drops, where a payload can be swapped without touching the skill.
const STAGING_HOST = hostPattern([...suspiciousDownload_1.PASTE_SITES, "cdn.discordapp.com/attachments", "transfer.sh"]);
// Tunnels that give a laptop a public address for a while: fine to run, odd as a fixed address in shipped code. Placeholders
// (xxx.trycloudflare.com) are documentation.
// An ngrok TCP endpoint (3.tcp.ngrok.io) is only ever a live address, so it counts wherever it appears.
const TUNNEL_HOST = new RegExp(`${ADDRESSED}(?!x+\\.|your-|example\\.)(?:[a-z0-9-]+\\.)+(ngrok(-free)?\\.(app|io|dev)|trycloudflare\\.com)\\b|(?<![a-z0-9.-])\\d+\\.tcp(\\.[a-z]{2})?\\.ngrok\\.io\\b`, "g");
// A line that is only a comment, where an address is documentation.
const COMMENT_LINE = /^\s*(#|\/\/|\/\*|\*|<!--|rem\s|::)/;
// The distinct suspicious hosts a line addresses, and whether any is a relay.
function suspiciousHostsOn(text) {
    if (COMMENT_LINE.test(text))
        return { hosts: new Set(), relay: false };
    const names = (pattern) => [...text.matchAll(pattern)].map((m) => m[1] ?? m[0]);
    const relays = names(RELAY_HOST);
    const ips = [...text.matchAll(new RegExp(PUBLIC_IP_URL, "g"))].map((m) => m[0]);
    return { hosts: new Set([...relays, ...names(STAGING_HOST), ...names(TUNNEL_HOST).map(() => "tunnel"), ...ips]), relay: relays.length > 0 };
}
// A scanner's own indicator list: an indicator inside a regex alternation (xmrig|stratum), or a line naming several hosts.
const IN_ALTERNATION = /(\||\(\?:)\s*(\\b)?(xmrig|stratum|cryptonight|minerd)|(xmrig|cryptonight|minerd|stratum\\?\+(tcp|ssl))(\\b)?\s*\|/;
const MAKES_EXECUTABLE = /\bchmod\s+(\+x|u\+x|[0-7]?7[0-7]{2})\b|\bos\.chmod\s*\([^)]*,\s*0o?7[0-7]{2}\b|\bchmodsync\s*\([^)]*,\s*0o?7[0-7]{2}\b/;
// Places that start a program on their own: shell startup files, login items, services, scheduled jobs.
const STARTUP_LOCATION = /\.(bashrc|zshrc|bash_profile|zprofile|profile)\b|\blaunchagents\b|\blaunchdaemons\b|start menu\W+programs\W+startup\b|currentversion\\+run\b|\.config\/systemd\/user\b|\/etc\/systemd\/system\b|\bcrontab\s+-(?!l)|\|\s*crontab\b|\/etc\/cron\./;
const APPENDS_OR_WRITES = /\bopen\s*\([^)]*['"]a\+?['"]|>>|\bwritefile(sync)?\b|\bappendfile(sync)?\b|\bwrite_text\s*\(|\.write\s*\(/;
// The whole environment serialised or piped, not one variable read or the environment handed to a child process.
const WHOLE_ENVIRONMENT = /(?<!\benv\s*=\s*)\bdict\(\s*os\.environ\s*\)|\bjson\.dumps\(\s*(dict\()?\s*os\.environ\b|\bjson\.stringify\(\s*process\.env\s*\)|(^|[\s;&(])(env|printenv)\s*\|\s*(curl|wget|nc|base64|python3?|node|sh|bash)\b/;
function scanCodeThreats(input) {
    const lines = input.normalized.lines;
    const fileHas = (pattern) => lines.some(({ text }) => pattern.test(text));
    const fileSends = fileHas(SENDS_DATA);
    const fileMakesExecutable = fileHas(MAKES_EXECUTABLE);
    const fileWritesStartupFile = fileHas(STARTUP_LOCATION) && (fileHas(APPENDS_OR_WRITES) || fileHas(/\|\s*crontab\b/));
    const fileConnectsSocket = fileHas(OPENS_SOCKET) && fileHas(CONNECTS);
    const findings = [];
    for (const { line, text } of lines) {
        if (RUNS_DOWNLOADED_CODE.test(text)) {
            findings.push((0, scanInput_1.findingAt)(input, line, { severity: "critical", category: "remote-access", detail: "Runs code it downloads while running" }));
        }
        else if (RUNS_DECODED_TEXT.some((pattern) => pattern.test(text))) {
            findings.push((0, scanInput_1.findingAt)(input, line, {
                severity: "warning",
                category: "obfuscation",
                detail: "Runs code it decodes from base64 or a compressed blob, which hides what runs from a reader",
            }));
        }
        if (REVERSE_SHELL.test(text) || (fileConnectsSocket && SOCKET_TO_SHELL.test(text))) {
            findings.push((0, scanInput_1.findingAt)(input, line, { severity: "critical", category: "remote-access", detail: "Opens a shell for a remote machine (reverse shell)" }));
        }
        if (MINER.test(text) && !IN_ALTERNATION.test(text)) {
            findings.push((0, scanInput_1.findingAt)(input, line, { severity: "critical", category: "crypto-mining", detail: "Runs or configures a cryptocurrency miner" }));
        }
        if (SETUID.test(text)) {
            findings.push((0, scanInput_1.findingAt)(input, line, { severity: "warning", category: "privilege-escalation", detail: "Sets the setuid or setgid bit, so the program runs with its owner's rights" }));
        }
        if (RANSOM_NOTE.test(text)) {
            findings.push((0, scanInput_1.findingAt)(input, line, { severity: "warning", category: "destructive-commands", detail: "Has the wording of a ransom note" }));
        }
        if (fileSends && WHOLE_ENVIRONMENT.test(text)) {
            findings.push((0, scanInput_1.findingAt)(input, line, { severity: "critical", category: "exfiltration", detail: "Sends out every environment variable, where API keys and tokens live" }));
        }
        const { hosts, relay } = suspiciousHostsOn(text);
        if (hosts.size === 1) {
            findings.push((0, scanInput_1.findingAt)(input, line, suspiciousHostFinding({ fileMakesExecutable, fileWritesStartupFile, fileSends, relay })));
        }
        if (!fileSends || !CREDENTIAL_FILE.test(text))
            continue;
        findings.push((0, scanInput_1.findingAt)(input, line, SENDS_DATA.test(text)
            ? { severity: "critical", category: "exfiltration", detail: "Reads a credential file and sends it over the network" }
            : { severity: "warning", category: "exfiltration", detail: "Reads a credential file in a script that also sends data over the network" }));
    }
    return (0, scanInput_1.capFindings)(findings);
}
// A raw IP address or throwaway host is a warning alone, and critical in a file that also makes something executable or writes
// to a startup location, or that sends data while naming a request relay. Some apps still ship their own server's raw address,
// so a send beside one is only a warning.
function suspiciousHostFinding(file) {
    const host = "a raw IP address or throwaway host";
    if (file.fileMakesExecutable) {
        return { severity: "critical", category: "suspicious-download", detail: `Fetches from ${host} in a file that makes a download executable` };
    }
    if (file.fileWritesStartupFile) {
        return { severity: "critical", category: "persistence", detail: `Names ${host} in a file that sets a program to start on its own` };
    }
    if (file.fileSends && file.relay)
        return { severity: "critical", category: "exfiltration", detail: "Sends data in a file that names a request relay" };
    return { severity: "warning", category: "suspicious-download", detail: `Talks to ${host}, where malware is often staged` };
}
