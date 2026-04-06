export type ConnectionForm = {
  name: string;
  host: string;
  port: string;
  username: string;
  password: string;
};

export type ConnectionProfile = {
  id: string;
  name: string;
  host: string;
  port: string;
  username: string;
  pinned: boolean;
  lastUsedAt: string | null;
  lastConnectionOutcome: "success" | "error" | null;
  lastConnectionMessage: string | null;
  lastConnectionAt: string | null;
  updatedAt: string;
};

const CONNECTION_DRAFT_STORAGE_KEY = "fshell-connection-draft";
const CONNECTION_PROFILES_STORAGE_KEY = "fshell-connection-profiles";
const ACTIVE_CONNECTION_PROFILE_STORAGE_KEY = "fshell-active-connection-profile";

export const initialConnectionForm: ConnectionForm = {
  name: "我的服务器",
  host: "127.0.0.1",
  port: "22",
  username: "root",
  password: ""
};

export function toFormFromProfile(profile: ConnectionProfile, password = ""): ConnectionForm {
  return {
    name: profile.name,
    host: profile.host,
    port: profile.port,
    username: profile.username,
    password
  };
}

function sanitizeConnectionProfile(value: unknown): ConnectionProfile | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<ConnectionProfile>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.host !== "string" ||
    typeof candidate.port !== "string" ||
    typeof candidate.username !== "string" ||
    typeof candidate.updatedAt !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    name: candidate.name,
    host: candidate.host,
    port: candidate.port,
    username: candidate.username,
    pinned: Boolean(candidate.pinned),
    lastUsedAt: typeof candidate.lastUsedAt === "string" ? candidate.lastUsedAt : null,
    lastConnectionOutcome:
      candidate.lastConnectionOutcome === "success" || candidate.lastConnectionOutcome === "error"
        ? candidate.lastConnectionOutcome
        : null,
    lastConnectionMessage: typeof candidate.lastConnectionMessage === "string" ? candidate.lastConnectionMessage : null,
    lastConnectionAt: typeof candidate.lastConnectionAt === "string" ? candidate.lastConnectionAt : null,
    updatedAt: candidate.updatedAt
  };
}

function sanitizeConnectionDraft(value: unknown): ConnectionForm {
  if (!value || typeof value !== "object") {
    return initialConnectionForm;
  }

  const candidate = value as Partial<ConnectionForm>;
  return {
    name: typeof candidate.name === "string" ? candidate.name : initialConnectionForm.name,
    host: typeof candidate.host === "string" ? candidate.host : initialConnectionForm.host,
    port: typeof candidate.port === "string" ? candidate.port : initialConnectionForm.port,
    username: typeof candidate.username === "string" ? candidate.username : initialConnectionForm.username,
    password: ""
  };
}

export function sortConnectionProfiles(profiles: ConnectionProfile[]): ConnectionProfile[] {
  return [...profiles].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return left.pinned ? -1 : 1;
    }

    const leftLastUsed = left.lastUsedAt ?? "";
    const rightLastUsed = right.lastUsedAt ?? "";
    if (leftLastUsed !== rightLastUsed) {
      return rightLastUsed.localeCompare(leftLastUsed);
    }

    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

export function readStoredConnectionProfiles(): ConnectionProfile[] {
  try {
    const raw = window.localStorage.getItem(CONNECTION_PROFILES_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return sortConnectionProfiles(
      parsed
        .map((item) => sanitizeConnectionProfile(item))
        .filter((item): item is ConnectionProfile => Boolean(item))
    );
  } catch (error) {
    console.error(error);
    return [];
  }
}

export function readStoredActiveProfileId(): string {
  try {
    return window.localStorage.getItem(ACTIVE_CONNECTION_PROFILE_STORAGE_KEY) ?? "";
  } catch (error) {
    console.error(error);
    return "";
  }
}

export function resolveInitialConnectForm(): ConnectionForm {
  const profiles = readStoredConnectionProfiles();
  const activeProfileId = readStoredActiveProfileId();
  const activeProfile = profiles.find((item) => item.id === activeProfileId);

  if (activeProfile) {
    return toFormFromProfile(activeProfile);
  }

  try {
    const raw = window.localStorage.getItem(CONNECTION_DRAFT_STORAGE_KEY);
    if (!raw) {
      return initialConnectionForm;
    }

    return sanitizeConnectionDraft(JSON.parse(raw));
  } catch (error) {
    console.error(error);
    return initialConnectionForm;
  }
}

export function buildConnectionProfile(form: ConnectionForm, profileId?: string): ConnectionProfile {
  const now = new Date().toISOString();
  return {
    id: profileId ?? `profile-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: form.name.trim() || `${form.username.trim() || "user"}@${form.host.trim() || "host"}`,
    host: form.host.trim(),
    port: form.port.trim(),
    username: form.username.trim(),
    pinned: false,
    lastUsedAt: null,
    lastConnectionOutcome: null,
    lastConnectionMessage: null,
    lastConnectionAt: null,
    updatedAt: now
  };
}

export function upsertConnectionProfile(
  profiles: ConnectionProfile[],
  profile: ConnectionProfile
): ConnectionProfile[] {
  return sortConnectionProfiles([profile, ...profiles.filter((item) => item.id !== profile.id)]);
}

export function profileMatchesForm(profile: ConnectionProfile, form: ConnectionForm): boolean {
  return (
    profile.host === form.host.trim() &&
    profile.port === form.port.trim() &&
    profile.username === form.username.trim()
  );
}

export function persistConnectionDraft(form: ConnectionForm) {
  try {
    window.localStorage.setItem(
      CONNECTION_DRAFT_STORAGE_KEY,
      JSON.stringify({
        ...form,
        password: ""
      })
    );
  } catch (error) {
    console.error(error);
  }
}

export function persistConnectionProfiles(profiles: ConnectionProfile[]) {
  try {
    window.localStorage.setItem(CONNECTION_PROFILES_STORAGE_KEY, JSON.stringify(profiles));
  } catch (error) {
    console.error(error);
  }
}

export function persistActiveProfileId(profileId: string) {
  try {
    if (profileId) {
      window.localStorage.setItem(ACTIVE_CONNECTION_PROFILE_STORAGE_KEY, profileId);
    } else {
      window.localStorage.removeItem(ACTIVE_CONNECTION_PROFILE_STORAGE_KEY);
    }
  } catch (error) {
    console.error(error);
  }
}
