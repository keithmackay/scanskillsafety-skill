"use strict";
// ABOUTME: The files and stores that hold logins, keys and wallets (SSH keys, cloud, registry and Git credentials, the macOS keychain,
// ABOUTME: browser login stores, crypto wallets), shared by the code rule for one sent out and the prose rule for text asking for one.
Object.defineProperty(exports, "__esModule", { value: true });
exports.CREDENTIAL_FILE = void 0;
const SEP = "[\\\\/]";
// Private keys and stored logins; a public key (.pub) or ~/.ssh/config is not a secret.
const LOGIN_FILES = /\.ssh\/id_(rsa|dsa|ecdsa|ed25519)(?![\w.]*\.pub)\b|\.aws\/credentials|\.netrc\b|\.git-credentials|\.config\/gh\/hosts\.yml|\.docker\/config\.json|\.kube\/config\b|\.npmrc\b|\.pypirc\b/;
// The macOS keychain dumped, or the key a browser encrypts its saved logins with ("Chrome Safe Storage"). A tool reading its own
// entry by service name is ordinary.
const KEYCHAIN = /\bsecurity\s+dump-keychain\b|\bfind-generic-password\b[^\n|;]*(safe\s+storage|chrome|chromium|brave|edge|opera|vivaldi)|\blogin\.keychain(-db)?\b/;
// Browsers' saved logins, cookies and wallet extensions' storage (MetaMask's and Phantom's extension ids).
const BROWSER_STORES = new RegExp(`(google${SEP}chrome|chromium|brave-browser|microsoft${SEP}edge|opera software|vivaldi)[^\\n'"]*?${SEP}(login data|cookies|web data)\\b` +
    `|\\bkey[34]\\.db\\b|firefox[^\\n'"]*?${SEP}(logins\\.json|cookies\\.sqlite)\\b|local extension settings` +
    "|nkbihfbeogaeaoehlefnkodbefgpgknn|bfnaelmomeimhlpmgjnjophhpkkoljpa");
const WALLETS = new RegExp(`\\bwallet\\.dat\\b|exodus${SEP}exodus\\.wallet|electrum${SEP}wallets|\\.ethereum${SEP}keystore|\\.config${SEP}solana${SEP}id\\.json|atomic${SEP}local storage`);
exports.CREDENTIAL_FILE = new RegExp([LOGIN_FILES, KEYCHAIN, BROWSER_STORES, WALLETS].map((re) => re.source).join("|"));
