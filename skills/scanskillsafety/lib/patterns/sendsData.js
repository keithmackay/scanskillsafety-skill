"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SENDS_DATA = void 0;
// ABOUTME: Recognises a line that sends data out over the network (an HTTP POST or upload, netcat to a host), shared by the code
// ABOUTME: rules for credentials sent out and by the download rules, which leave an upload to a file host alone.
exports.SENDS_DATA = /\bcurl\b.*(\s-d(\s|@)|--data|\s-f\s|--form|\s-t\s|--upload-file|-x\s*post)|\bwget\b.*--post|\b(requests|httpx|axios)\.(post|put)\s*\(|method\s*:\s*['"]post|\bnc\s+[\w.-]+\s+\d+|urlopen\([^)]*data=|invoke-(webrequest|restmethod)\b.*-method\s+post/;
