"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanCodeThreats = scanCodeThreats;
// ABOUTME: Flags threats only code shows, for the script scan: code decoded or downloaded and run, reverse shells, miners, setuid,
// ABOUTME: unchecked coding agents, ransom notes, throwaway hosts, DNS lookups carrying data, secrets sent out. Not run over READMEs.
const scanInput_1 = require("../scanInput");
const exfiltration_1 = require("./exfiltration");
const suspiciousDownload_1 = require("./suspiciousDownload");
const credentialFiles_1 = require("./credentialFiles");
const sendsData_1 = require("./sendsData");
// Lines are matched in their normalized form: lower case, invisible characters and look-alikes removed.
const RUNS_DECODED_TEXT = [
    /\beval\s*\(\s*buffer\.from\([^)]*['"]base64['"]/,
    /\beval\s*\(\s*atob\s*\(/,
    /\bnew\s+function\s*\(\s*atob\s*\(/,
    /\b(exec|eval)\s*\(\s*(zlib\.decompress\s*\(\s*)?(base64\.b64decode|codecs\.decode|zlib\.decompress|marshal\.loads)\b/,
    /\b(powershell|pwsh)\b.*\s-(enc|encodedcommand|ec)\s+[a-z0-9+/=]{8,}/,
    /\b(iex|invoke-expression)\b.*frombase64string/,
    /\b(exec|eval)\s*\(\s*(bytes\.fromhex|binascii\.unhexlify)\s*\(/,
    /\beval\s*\(\s*buffer\.from\([^)]*['"]hex['"]/,
    /\bxxd\s+-r\s+-p\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/,
    /\b(exec|eval)\s*\(\s*['"]{2}\.join\s*\(\s*(map\s*\(\s*chr\b|\[?\s*chr\s*\()/,
    /\beval\s*\(\s*string\.fromcharcode\s*\(/,
    /\b(exec|eval)\s*\([^;\n]{0,200}?\[\s*::\s*-1\s*\]/,
    /\beval\s*\([^;\n]{0,200}?\.split\(\s*['"]{2}\s*\)\.reverse\(\)\.join\(/,
];
// The download must sit inside the same statement as the eval, not anywhere later on a long minified line.
const RUNS_DOWNLOADED_CODE = /\b(exec|eval)\s*\([^;]{0,80}?\b(requests\.get|urlopen|urllib\.request|fetch\s*\(|https?\.get|axios\.get)/;
// Python's exec of a name that was set from a download or a decoding: code that arrives as data. Reading a version file line
// by line, or a test running its own code, is not that.
const EXECS_A_NAME = /(?<![\w.])exec\s*\(\s*([a-z_]\w*)\s*[,)]/;
const ASSIGNS = /^\s*([a-z_]\w*)\s*=\s*(.*)$/;
const CODE_SOURCE = /\b(requests|httpx)\.(get|post)\s*\(|\burlopen\s*\(|\.(text|content)\b|\.read\(\)|\.json\(\)|\bb64decode\s*\(|\.decrypt\s*\(|\bdecompress\s*\(|\bmarshal\.loads\s*\(|\bfromhex\s*\(|\bunhexlify\s*\(/;
const PYTHON_DOWNLOADS = /\b(requests|httpx)\.(get|post)\s*\(|\burlopen\s*\(|\burllib\.request\b|\burlretrieve\s*\(/;
const PYTHON_DECODES = /\bb64decode\s*\(|\.decrypt\s*\(|\bfernet\s*\(|\bmarshal\.loads\s*\(|\bzlib\.decompress\s*\(|\bbytes\.fromhex\s*\(|\bunhexlify\s*\(/;
// A DNS name built from data and looked up, the lookup run as a command: the data leaves in the query, past filters that only
// watch web traffic.
const DNS_CARRIES_DATA = /(?:^\s*|[|;&(`]\s*|\$\(\s*)(nslookup|dig|host)\s+[^|;&\n]*?(\$\([^)]*\)|\$\{[^}]*\}|\$[a-z_]\w*|`[^`]*`)[\w.-]*\.[a-z0-9-]+\.[a-z]{2,}|\bgethostbyname\(\s*f?['"][^'"]*\{[^}]+\}[\w.-]*\.[a-z0-9-]+\.[a-z]{2,}|\bdns\.(lookup|resolve\w*)\(\s*`[^`]*\$\{[^}]+\}[\w.-]*\.[a-z0-9-]+\.[a-z]{2,}/;
// Names like _0x1a2b, the mark of javascript-obfuscator; a few are ordinary, dozens mean the file was run through it.
const OBFUSCATED_NAME = /\b_0x[0-9a-f]{4,6}\b/g;
const OBFUSCATED_NAMES_MIN = 20;
// A git template or hooks folder set for every repository: its hooks then run on every commit, checkout or clone.
const GLOBAL_GIT_HOOKS = /\bgit\s+config\s+(--global|--system)\s+(init\.templatedir|core\.hookspath)\b/;
// A coding agent started with its permission prompts turned off, so it runs whatever it decides without asking.
// The flag must follow the command within a few arguments, so prose describing the bypass does not count.
const flagAfter = (command, flags) => `\\b${command}\\b\\S*(\\s+[^\\s|;&]+){0,6}?\\s+["']?(${flags})\\b`;
const UNSAFE_AGENT_RUN = new RegExp([
    flagAfter("claude", "--dangerously-skip-permissions"),
    flagAfter("gemini", "--yolo|--approval-mode[= ]yolo"),
    flagAfter("codex", "--dangerously-bypass-approvals-and-sandbox|--yolo"),
    "--trust-all-tools\\b",
].join("|"));
// What an infostealer asks such an agent to find: credential files, keys and wallets.
const NAMES_CREDENTIALS = /\b(wallets?|wallet\.dat|keystores?|seed\s+phrases?|mnemonics?|private\s+keys?|id_(rsa|dsa|ecdsa|ed25519))\b|~\/\.ssh\b/;
// A shell started interactively on a /dev/tcp connection, netcat handing a shell to a host, or (in a file that opens a socket
// and connects it) the socket wired to a shell's input and output. A /dev/tcp port probe or an os.dup2 to a log file is neither.
const REVERSE_SHELL = /\b(ba|z)?sh\s+-i\b.*\/dev\/tcp\/|\/dev\/tcp\/\S+\s+0>&1|\bnc(at)?\s+(-\w+\s+)*-e\s/;
const SOCKET_TO_SHELL = /\bos\.dup2\s*\(\s*\w+\.fileno\(\)|\bpty\.spawn\s*\(/;
const OPENS_SOCKET = /\bsocket\.socket\s*\(/;
const CONNECTS = /\.connect\s*\(/;
const MINER = /\bxmrig\b|stratum\+(tcp|ssl):\/\/|\bcryptonight\b|\bminerd\b|--donate-level\b/;
// setuid as a shell command, an os.chmod mode, a stat.S_ISUID flag, or chmod's arguments in a list handed to a process. setgid
// alone (2775, g+s) is how shared folders keep their group, so only the setuid bit counts.
const SETUID = /\bchmod\s+(u\+s\b|ug\+s\b|\+s\b|[4-7][0-7]{3}\b)|\bos\.chmod\s*\([^)]*,\s*0o?[4-7][0-7]{3}\b|\bchmod\w*\s*\([^)]*\bs_isuid\b|['"]chmod['"]\s*,\s*\[?\s*(['"]-r['"]\s*,\s*)?['"](u\+s|ug\+s|\+s|[4-7][0-7]{3})['"]/;
// A setuid mode kept in a constant, which counts in a file that changes modes.
// 0o7777 is the mask for every permission bit, and a mode after & or | is masked or compared, not set.
const SETUID_MODE = /(?<![&|]\s*)\b0o(?!7777)[4-7][0-7]{3}\b/;
const CHANGES_MODES = /\bchmod/;
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
// Link shorteners and anonymous file drops: what they serve can change unseen, so fetching from one counts. Creating a short link
// or uploading a file to one is what they are for.
const HIDDEN_SOURCE_HOST = hostPattern([...suspiciousDownload_1.LINK_SHORTENERS, ...suspiciousDownload_1.FILE_DROPS]);
const FETCHES = /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|urlretrieve|urlopen|axios\.get)\b|\b(requests|httpx)\.get\s*\(|\bfetch\s*\(|\bhttps?\.get\s*\(/;
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
    const hiddenSources = FETCHES.test(text) && !sendsData_1.SENDS_DATA.test(text) ? names(HIDDEN_SOURCE_HOST) : [];
    return { hosts: new Set([...relays, ...names(STAGING_HOST), ...hiddenSources, ...names(TUNNEL_HOST).map(() => "tunnel"), ...ips]), relay: relays.length > 0 };
}
// A scanner's own indicator list: an indicator inside a regex alternation (xmrig|stratum), or a line naming several hosts.
const IN_ALTERNATION = /(\||\(\?:)\s*(\\b)?(xmrig|stratum|cryptonight|minerd)|(xmrig|cryptonight|minerd|stratum\\?\+(tcp|ssl))(\\b)?\s*\|/;
const MAKES_EXECUTABLE = /\bchmod\s+(\+x|u\+x|[0-7]?7[0-7]{2})\b|\bos\.chmod\s*\([^)]*,\s*0o?7[0-7]{2}\b|\bchmodsync\s*\([^)]*,\s*0o?7[0-7]{2}\b/;
// Places that start a program on their own: shell startup files, login items, services, scheduled jobs.
const STARTUP_LOCATION = /\.(bashrc|zshrc|bash_profile|zprofile|profile)\b|\blaunchagents\b|\blaunchdaemons\b|start menu\W+programs\W+startup\b|currentversion\\+run\b|\.config\/systemd\/user\b|\/etc\/systemd\/system\b|\bcrontab\s+-(?!l)|\|\s*crontab\b|\/etc\/cron\./;
const APPENDS_OR_WRITES = /\bopen\s*\([^)]*['"]a\+?['"]|>>|\bwritefile(sync)?\b|\bappendfile(sync)?\b|\bwrite_text\s*\(|\.write\s*\(/;
// The whole environment serialised or piped, not one variable read or the environment handed to a child process.
const WHOLE_ENVIRONMENT = /(?<!\benv\s*=\s*)\bdict\(\s*os\.environ\s*\)|\bjson\.dumps\(\s*(dict\()?\s*os\.environ\b|\bjson\.stringify\(\s*process\.env\s*\)|(^|[\s;&(])(env|printenv)\s*\|\s*(curl|wget|nc|base64|python3?|node|sh|bash)\b/;
// The whole environment copied, iterated or kept as a value, which a file that sends data may be collecting. Named variables
// destructured from it ({ A, B } = process.env) are ordinary reads. A copy made to hand
// to a child process (env=…, .update(…) nearby) is how programs set a child's variables.
const COPIES_ENVIRONMENT = /\bos\.environ\.(copy|items)\(\)|[\w\]]\s*=\s*os\.environ\s*$|:\s*os\.environ\s*[,}]|[\w\]]\s*=\s*process\.env\s*;?\s*$|\bobject\.(entries|keys)\(\s*process\.env\s*\)|\bin\s+process\.env\b/;
const HANDS_TO_CHILD = /\benv\s*[=:]\s*[\w{]|\.update\s*\(/;
const NEAR_LINES = 3;
// A link to a Windows program, which code has little reason to name but to fetch and start it. A project's GitHub release
// assets are how real tools ship, and a POST to a server's .exe endpoint is an API call.
const WINDOWS_PROGRAM_URL = /https?:\/\/[^\s'"`)<>]+\.(exe|scr|bat|cmd|msi|vbs|hta|dll|jar)(\?[^\s'"`)<>]*)?(?=[\s'"`)<>]|$)/;
const GITHUB_RELEASE = /github\.com\/[^/\s]+\/[^/\s]+\/(releases\/(download|latest)|blob|tree)\//;
// A command added to a shell start-up file runs in every new terminal. Setting variables, aliases, sourcing a tool's own
// setup and shell conditionals are what installers add; anything else is a program started on each login.
const SHELL_PROFILE = /\.(bashrc|zshrc|bash_profile|zprofile|profile|zshenv)\b/;
const OPENS_FOR_APPEND = /\bopen\s*\(.*,\s*['"]a\+?['"]|\bappendfile(sync)?\s*\(/;
const WRITES_TEXT = /\.write\s*\(\s*f?(['"])(.*?)\1\s*\)/;
// The writes that follow an append-open of a start-up file, by name or through a variable set from its path.
const WRITES_REACH = 10;
const ECHOES_TO_PROFILE = /\becho\s+(-e\s+)?(['"])(.*?)\2\s*>>\s*\S*\.(bashrc|zshrc|bash_profile|zprofile|profile|zshenv)\b/;
const PROFILE_SETTING = /^(export\s|alias\s|source\s|\.\s|eval\s|path=|set\s|unset\s|if\s|then\b|else\b|fi\b|\[|complete\s|fpath|#)/;
const addsProgramToProfile = (written) => written
    .split(/\\n|\n/)
    .map((l) => l.trim().replace(/^[\\'"]+/, ""))
    .some((l) => l !== "" && !PROFILE_SETTING.test(l));
// A file put in the Windows Startup folder runs at every login. Naming the folder alone (listing it) is not that.
const WINDOWS_STARTUP_FOLDER = /start menu\W+programs\W+startup\b|\bshell:startup\b/;
const WRITES_FILE = /\bopen\s*\(.*,\s*['"](w|a|wb|ab|w\+|a\+)['"]|\.write_(text|bytes)\s*\(|\bwritefile(sync)?\s*\(|\bshutil\.(copy\w*|move)\s*\(|\bcopyfile(sync)?\s*\(|\b(copy-item|move-item)\b/;
// Files encrypted across a folder tree with the originals then removed or renamed: what ransomware does, and what a backup or
// a single secret's encryption does not.
const WALKS_FOLDERS = /\bos\.walk\s*\(|\.rglob\s*\(|\bglob\.glob\s*\([^)]*recursive\s*=\s*true|\breaddirsync\s*\([^)]*recursive/;
const ENCRYPTS = /\.encrypt\s*\(|\bfernet\s*\(|\baes\.new\s*\(|\bchacha20/;
const REMOVES_ORIGINAL = /\bos\.(remove|unlink|rename|replace)\s*\(|\.unlink\s*\(|\bfs\.(unlinksync|renamesync|unlink|rename)\s*\(/;
// What names this machine and its user. Two of them sent together identify a victim, as stealers report home first.
const MACHINE_IDENTITY = /\bsocket\.gethostname\(\)|\bplatform\.node\(\)|\bos\.uname\(\)|\bgetpass\.getuser\(\)|\bos\.getlogin\(\)|\bos\.hostname\(\)|\bos\.userinfo\(\)/g;
// `inDocs` leaves out the rules on hosts, raw IP addresses, links to programs, credential files and global git hooks,
// which docs show as examples and install steps.
function scanCodeThreats(input, options = {}) {
    const addresses = !options.inDocs;
    const lines = input.normalized.lines;
    const fileHas = (pattern) => lines.some(({ text }) => pattern.test(text));
    const fileSends = fileHas(sendsData_1.SENDS_DATA);
    const fileMakesExecutable = fileHas(MAKES_EXECUTABLE);
    const fileWritesStartupFile = fileHas(STARTUP_LOCATION) && (fileHas(APPENDS_OR_WRITES) || fileHas(/\|\s*crontab\b/));
    const fileConnectsSocket = fileHas(OPENS_SOCKET) && fileHas(CONNECTS);
    const fileChangesModes = fileHas(CHANGES_MODES);
    const fileDownloads = fileHas(PYTHON_DOWNLOADS);
    const fileDecodes = fileHas(PYTHON_DECODES);
    const fileWritesFiles = fileHas(WRITES_FILE);
    const fileEncryptsTree = fileHas(WALKS_FOLDERS) && fileHas(REMOVES_ORIGINAL);
    const assigned = (source) => new Set(lines.flatMap(({ text }) => {
        const m = text.match(ASSIGNS);
        return m && source.test(m[2]) ? [m[1]] : [];
    }));
    const codeNames = assigned(CODE_SOURCE);
    const profileNames = assigned(SHELL_PROFILE);
    const profileOpens = lines
        .filter(({ text }) => OPENS_FOR_APPEND.test(text) && (SHELL_PROFILE.test(text) || [...profileNames].some((n) => new RegExp(`\\b${n}\\b`).test(text))))
        .map(({ line }) => line);
    const writesToProfile = (line) => profileOpens.some((open) => line >= open && line - open <= WRITES_REACH);
    const fileNamesCredentials = fileHas(NAMES_CREDENTIALS) || fileHas(credentialFiles_1.CREDENTIAL_FILE);
    const nearHandsToChild = (line) => lines.some((l) => Math.abs(l.line - line) <= NEAR_LINES && HANDS_TO_CHILD.test(l.text));
    const findings = [];
    const identityCalls = lines.flatMap(({ line, text }) => [...text.matchAll(MACHINE_IDENTITY)].map((m) => ({ line, call: m[0] })));
    if (fileSends && new Set(identityCalls.map((c) => c.call)).size >= 2) {
        findings.push((0, scanInput_1.findingAt)(input, identityCalls[0].line, { severity: "warning", category: "exfiltration", detail: "Collects the machine's name and user in a file that sends data" }));
    }
    const obfuscatedNames = lines.map(({ text }) => (text.match(OBFUSCATED_NAME) ?? []).length);
    if (obfuscatedNames.reduce((a, b) => a + b, 0) >= OBFUSCATED_NAMES_MIN) {
        const first = lines[obfuscatedNames.findIndex((n) => n > 0)].line;
        findings.push((0, scanInput_1.findingAt)(input, first, { severity: "warning", category: "obfuscation", detail: "Was run through a JavaScript obfuscator (_0x… names), which hides what it does" }));
    }
    for (const { line, text } of lines) {
        const execName = COMMENT_LINE.test(text) ? undefined : text.match(EXECS_A_NAME)?.[1];
        const execsAName = execName !== undefined && codeNames.has(execName);
        if (RUNS_DOWNLOADED_CODE.test(text) || (execsAName && fileDownloads)) {
            findings.push((0, scanInput_1.findingAt)(input, line, { severity: "critical", category: "remote-access", detail: "Runs code it downloads while running" }));
        }
        else if (!COMMENT_LINE.test(text) && (RUNS_DECODED_TEXT.some((pattern) => pattern.test(text)) || (execsAName && fileDecodes))) {
            findings.push((0, scanInput_1.findingAt)(input, line, {
                severity: "warning",
                category: "obfuscation",
                detail: "Runs code it decodes (base64, hex, character codes, reversed text or a compressed blob), which hides what runs from a reader",
            }));
        }
        if (REVERSE_SHELL.test(text) || (fileConnectsSocket && SOCKET_TO_SHELL.test(text))) {
            findings.push((0, scanInput_1.findingAt)(input, line, { severity: "critical", category: "remote-access", detail: "Opens a shell for a remote machine (reverse shell)" }));
        }
        if (MINER.test(text) && !IN_ALTERNATION.test(text)) {
            findings.push((0, scanInput_1.findingAt)(input, line, { severity: "critical", category: "crypto-mining", detail: "Runs or configures a cryptocurrency miner" }));
        }
        if (SETUID.test(text) || (fileChangesModes && SETUID_MODE.test(text))) {
            findings.push((0, scanInput_1.findingAt)(input, line, { severity: "warning", category: "privilege-escalation", detail: "Sets the setuid bit, so the program runs with its owner's rights" }));
        }
        if (UNSAFE_AGENT_RUN.test(text)) {
            // Autonomous-loop skills do this for ordinary work; with credentials named in the same file it is how s1ngularity stole them.
            findings.push((0, scanInput_1.findingAt)(input, line, fileNamesCredentials
                ? { severity: "critical", category: "privilege-escalation", detail: "Starts a coding agent with its permission prompts off, in a file that names credentials, keys or wallets" }
                : { severity: "info", category: "privilege-escalation", detail: "Starts a coding agent with its permission prompts off" }));
        }
        if (fileWritesFiles && !COMMENT_LINE.test(text) && WINDOWS_STARTUP_FOLDER.test(text)) {
            findings.push((0, scanInput_1.findingAt)(input, line, { severity: "warning", category: "persistence", detail: "Puts a file in the Windows Startup folder, so it runs at every login" }));
        }
        if (fileEncryptsTree && ENCRYPTS.test(text)) {
            findings.push((0, scanInput_1.findingAt)(input, line, { severity: "warning", category: "destructive-commands", detail: "Encrypts files across folders and removes the originals, as ransomware does" }));
        }
        if (addresses && GLOBAL_GIT_HOOKS.test(text)) {
            findings.push((0, scanInput_1.findingAt)(input, line, { severity: "warning", category: "persistence", detail: "Sets a git template or hooks folder for every repository, so its scripts run on each commit or clone" }));
        }
        if (DNS_CARRIES_DATA.test(text)) {
            findings.push((0, scanInput_1.findingAt)(input, line, { severity: "warning", category: "exfiltration", detail: "Looks up a DNS name built from data, which carries it out past web filters" }));
        }
        if (RANSOM_NOTE.test(text)) {
            findings.push((0, scanInput_1.findingAt)(input, line, { severity: "warning", category: "destructive-commands", detail: "Has the wording of a ransom note" }));
        }
        if (fileSends && WHOLE_ENVIRONMENT.test(text)) {
            findings.push((0, scanInput_1.findingAt)(input, line, { severity: "critical", category: "exfiltration", detail: "Sends out every environment variable, where API keys and tokens live" }));
        }
        else if (fileSends && COPIES_ENVIRONMENT.test(text) && !nearHandsToChild(line)) {
            findings.push((0, scanInput_1.findingAt)(input, line, { severity: "warning", category: "exfiltration", detail: "Copies every environment variable, where API keys and tokens live, in a file that sends data" }));
        }
        const { hosts, relay } = addresses ? suspiciousHostsOn(text) : { hosts: new Set(), relay: false };
        if (hosts.size === 1) {
            findings.push((0, scanInput_1.findingAt)(input, line, suspiciousHostFinding({ fileMakesExecutable, fileWritesStartupFile, fileSends, relay })));
        }
        const written = writesToProfile(line) ? text.match(WRITES_TEXT)?.[2] : undefined;
        const echoed = text.match(ECHOES_TO_PROFILE)?.[3];
        if (hosts.size === 0 && [written, echoed].some((w) => w !== undefined && addsProgramToProfile(w))) {
            findings.push((0, scanInput_1.findingAt)(input, line, { severity: "warning", category: "persistence", detail: "Adds a command to a shell start-up file, so it runs in every new terminal" }));
        }
        // Reported once: a line already reported for its host or for running what it downloads needs no second finding.
        const reported = hosts.size > 0 || RUNS_DOWNLOADED_CODE.test(text);
        if (addresses && !reported && !COMMENT_LINE.test(text) && !sendsData_1.SENDS_DATA.test(text) && !GITHUB_RELEASE.test(text) && WINDOWS_PROGRAM_URL.test(text)) {
            findings.push((0, scanInput_1.findingAt)(input, line, { severity: "warning", category: "suspicious-download", detail: "Links to a Windows program from code, which is how droppers fetch their payload" }));
        }
        if (!addresses || !fileSends || !credentialFiles_1.CREDENTIAL_FILE.test(text))
            continue;
        findings.push((0, scanInput_1.findingAt)(input, line, sendsData_1.SENDS_DATA.test(text)
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
