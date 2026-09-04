(function () {
  const PAGE_NAMES = Object.freeze([
    "offer-list-tracker",
    "payments",
    "publishers",
    "monthly-new-merchants",
    "brand-media",
    "revenue-flow",
    "google-ads",
    "sheets",
    "category",
    "tier",
    "dashboard",
    "agent"
  ]);

  function normalizeLevel(value) {
    if (typeof value === "boolean" || value === null || value === undefined) return null;
    const text = typeof value === "string" ? value.trim() : value;
    if (text === "") return null;
    try {
      const level = Number(text);
      return Number.isInteger(level) && level >= 0 && level <= 2 ? level : null;
    } catch (_error) {
      return null;
    }
  }

  function normalizeUser(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (["password_hash", "passwordHash", "role"].some((key) => Object.prototype.hasOwnProperty.call(value, key))) return null;
    const level = normalizeLevel(value.level);
    const username = typeof value.username === "string" ? value.username.trim() : "";
    if (level === null || !username) return null;
    return {
      id: typeof value.id === "number" || typeof value.id === "string" ? value.id : null,
      username,
      displayName: typeof value.displayName === "string" ? value.displayName : "",
      email: typeof value.email === "string" ? value.email : "",
      level,
      ...(typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt) ? { expiresAt: value.expiresAt } : {}),
      ...(value.authDisabled === true ? { authDisabled: true } : {})
    };
  }

  function canAccessPage(level, page) {
    if (!PAGE_NAMES.includes(page)) return false;
    const normalized = normalizeLevel(level);
    if (normalized === 0) return true;
    if (normalized === 1) return page !== "google-ads";
    if (normalized === 2) return page === "google-ads";
    return false;
  }

  function allowedPages(level) {
    return PAGE_NAMES.filter((page) => canAccessPage(level, page));
  }

  function defaultPageForLevel(level) {
    return normalizeLevel(level) === 2 ? "google-ads" : "agent";
  }

  window.OI_PAGE_ACCESS = Object.freeze({
    PAGE_NAMES,
    normalizeLevel,
    normalizeUser,
    allowedPages,
    canAccessPage,
    defaultPageForLevel
  });
})();
