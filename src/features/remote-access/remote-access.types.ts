export interface RemoteAccess {
  id: string;
  label: string;
  host: string;
  port: number;
  user: string;
  identityFile?: string | null;
  rootPaths: string[];
  knownHostSha256?: string | null;
  createdAt: string;
  lastConnectedAt?: string | null;
}

export interface RemoteAccessDraft {
  id?: string | null;
  label: string;
  host: string;
  port: number;
  user: string;
  identityFile?: string | null;
  rootPaths: string[];
}

export interface RemoteAccessTestResult {
  status: "trusted" | "untrusted";
  fingerprintSha256: string;
  message?: string | null;
}

export interface RemoteProjectCandidate {
  name: string;
  path: string;
  markers: string[];
}
