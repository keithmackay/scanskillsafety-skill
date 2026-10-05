"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAFETY_CATEGORY_LABEL = void 0;
exports.SAFETY_CATEGORY_LABEL = {
    "role-override": "Instruction override / prompt injection",
    exfiltration: "Exfiltration-looking URL",
    obfuscation: "Obfuscation",
    secrets: "Hardcoded secret",
    "destructive-commands": "Destructive shell command",
    "suspicious-download": "Fake prerequisite / suspicious download",
    "remote-access": "Reverse shell",
    concealment: "Instructions hidden from the user",
    "github-tos-block": "Blocked by GitHub",
};
