(function () {
  const MODERN_SESSION_STORAGE_KEYS = [
    "oi_agent_memory_v1",
    "oi_agent_session_v1",
    "oi_chat_session_v1",
    "oiChatbotQuestionSessionId.v1"
  ];
  const MODERN_APP_SCRIPT = "./assets/modern/oi-modern.js?v=20260904-m7-final";
  const AUTH_READY_CLASS = "auth-ready";
  const reduceMotionQuery = "(prefers-reduced-motion: reduce)";

  const authShell = document.getElementById("authShell");
  const appShell = document.getElementById("appShell");
  const modernAppRoot = document.getElementById("modernAppRoot");
  const modernAppError = document.getElementById("modernAppError");
  const modernAppErrorMessage = document.getElementById("modernAppErrorMessage");
  const modernAppErrorRetry = document.getElementById("modernAppErrorRetry");
  const form = document.getElementById("authForm");
  const username = document.getElementById("authUsername");
  const password = document.getElementById("authPassword");
  const submit = document.getElementById("authSubmit");
  const status = document.getElementById("authStatus");
  const loadingSkeleton = document.getElementById("appLoadingSkeleton");
  const loadingStatus = document.getElementById("skeletonLoadingStatus");
  const loadingPercent = document.getElementById("skeletonLoadingPercent");
  const loadingTrack = document.getElementById("skeletonLoadingTrack");
  const loadingValue = document.getElementById("skeletonLoadingValue");
  const loadingNote = document.getElementById("skeletonLoadingNote");
  let authRefreshInFlight = false;

  function createLoadingProgress() {
    let current = 8;
    let driftTimer = null;
    let hideTimer = null;

    function stopDrift() {
      if (!driftTimer) return;
      window.clearInterval(driftTimer);
      driftTimer = null;
    }

    function set(value, message, note) {
      const next = Math.max(current, Math.min(100, Number(value) || 0));
      current = next;
      const rounded = Math.round(current);
      if (loadingStatus && message) loadingStatus.textContent = message;
      if (loadingNote && note) loadingNote.textContent = note;
      if (loadingPercent) loadingPercent.textContent = `${rounded}%`;
      if (loadingValue) loadingValue.style.transform = `scaleX(${current / 100})`;
      if (loadingTrack) {
        loadingTrack.setAttribute("aria-valuenow", String(rounded));
        loadingTrack.setAttribute("aria-valuetext", `${rounded}%: ${message || loadingStatus?.textContent || "Loading dashboard"}`);
      }
    }

    function driftTo(limit, message, note) {
      stopDrift();
      set(current, message, note);
      driftTimer = window.setInterval(() => {
        const remaining = limit - current;
        if (remaining <= 0.5) {
          stopDrift();
          return;
        }
        set(Math.min(limit, current + Math.max(0.5, Math.min(2, remaining * 0.12))), message, note);
      }, 650);
    }

    function finish(message, note) {
      stopDrift();
      set(100, message || "Dashboard ready", note || "Your workspace is ready");
      if (loadingSkeleton) loadingSkeleton.setAttribute("aria-busy", "false");
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        document.body.classList.remove("app-loading");
      }, reducedMotion() ? 0 : 320);
    }

    return { set, driftTo, finish, stop: stopDrift };
  }

  const loadingProgress = createLoadingProgress();
  window.__OI_LOADING_PROGRESS__ = loadingProgress;

  function reducedMotion() {
    return window.matchMedia && window.matchMedia(reduceMotionQuery).matches;
  }

  function setStatus(message, tone) {
    if (!status) return;
    status.textContent = message || "";
    status.dataset.tone = tone || "";
  }

  function setLoading(isLoading) {
    if (!submit) return;
    submit.disabled = Boolean(isLoading);
    submit.textContent = isLoading ? "Checking access" : "Unlock dashboard";
  }

  function gsapReady() {
    return Boolean(window.gsap && !reducedMotion());
  }

  function waitForGsap(timeoutMs) {
    if (gsapReady() || reducedMotion()) return Promise.resolve();
    return new Promise((resolve) => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        if (gsapReady() || Date.now() - started >= timeoutMs) {
          window.clearInterval(timer);
          resolve();
        }
      }, 40);
    });
  }

  function animateIntro() {
    document.body.classList.add(AUTH_READY_CLASS);
    if (!gsapReady()) return;
    const gsap = window.gsap;
    const mm = gsap.matchMedia();
    mm.add({ reduceMotion: reduceMotionQuery }, (context) => {
      if (context.conditions.reduceMotion) return;
      gsap.set("[data-auth-motion]", { autoAlpha: 0, y: 18 });
      gsap.set(".auth-signal-board > div", { autoAlpha: 0, y: 10 });
      gsap.to("[data-auth-motion]", {
        autoAlpha: 1,
        y: 0,
        duration: 0.72,
        ease: "power3.out",
        stagger: 0.08,
        overwrite: "auto"
      });
      gsap.to(".auth-signal-board > div", {
        autoAlpha: 1,
        y: 0,
        duration: 0.44,
        ease: "power2.out",
        stagger: 0.06,
        delay: 0.2,
        overwrite: "auto"
      });
    });
  }

  function animateError() {
    if (!gsapReady() || !form) return;
    window.gsap.fromTo(
      form,
      { x: -5 },
      { x: 0, duration: 0.42, ease: "elastic.out(1, 0.38)", clearProps: "transform" }
    );
  }

  function hideAuthThen(callback) {
    if (!authShell) {
      callback();
      return;
    }
    if (!gsapReady()) {
      callback();
      return;
    }
    window.gsap.to(authShell, {
      autoAlpha: 0,
      y: -10,
      duration: 0.32,
      ease: "power2.inOut",
      overwrite: "auto",
      onComplete: callback
    });
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      ...(options || {})
    });
    if ((response.status === 401 || response.status === 403) && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent("oi-auth-failure", { detail: { status: response.status } }));
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error || `Request failed with ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.body.appendChild(script);
    });
  }

  function clearModernSessionState() {
    try {
      const storage = window.localStorage;
      MODERN_SESSION_STORAGE_KEYS.forEach((key) => storage.removeItem(key));
    } catch (_error) {
      // A blocked localStorage must not prevent the server-side logout.
    }
  }

  function setAuthUser(value) {
    const access = window.OI_PAGE_ACCESS;
    const user = access && typeof access.normalizeUser === "function"
      ? access.normalizeUser(value)
      : null;
    const initialPage = user && typeof access.defaultPageForLevel === "function"
      ? access.defaultPageForLevel(user.level)
      : null;
    if (!user || !initialPage) throw new Error("Authenticated user page access is unavailable");
    window.__OI_AUTH_USER = user;
    window.__OI_INITIAL_PAGE = initialPage;
    return user;
  }

  function currentAuthUser() {
    const access = window.OI_PAGE_ACCESS;
    if (!access || typeof access.normalizeUser !== "function") return null;
    return access.normalizeUser(window.__OI_AUTH_USER);
  }

  function showLoginShell() {
    window.__OI_AUTH_USER = null;
    window.__OI_INITIAL_PAGE = null;
    if (modernAppRoot) modernAppRoot.replaceChildren();
    if (modernAppError) modernAppError.classList.add("hidden");
    if (appShell) appShell.classList.add("hidden");
    if (authShell) authShell.classList.remove("hidden");
    document.body.classList.add("auth-pending");
    document.body.classList.remove("modern-startup-error", "modern-only");
    setStatus("", "");
    username?.focus?.();
  }

  function showModernError(error) {
    const detail = error && error.message ? String(error.message).slice(0, 220) : "Unknown startup error";
    if (modernAppErrorMessage) {
      modernAppErrorMessage.textContent = `The modern application could not start (${detail}). Refresh the page or contact support.`;
    }
    if (modernAppError) modernAppError.classList.remove("hidden");
    if (appShell) appShell.classList.add("hidden");
    document.body.classList.remove("app-loading");
    document.body.classList.add("modern-startup-error");
    modernAppErrorRetry?.focus?.();
  }

  async function loadModernApp() {
    try {
      await loadScript(MODERN_APP_SCRIPT);
      if (!window.OI_MODERN_APP || typeof window.OI_MODERN_APP.bootstrap !== "function") {
        throw new Error("Modern frontend bootstrap API is unavailable");
      }
      let language = "zh";
      try {
        language = localStorage.getItem("offerLanguage") === "en" ? "en" : "zh";
      } catch (_error) {
        language = "zh";
      }
      const user = currentAuthUser();
      if (!user) throw new Error("Authenticated user is unavailable");
      const access = window.OI_PAGE_ACCESS;
      const initialPage = access && typeof access.defaultPageForLevel === "function"
        ? access.defaultPageForLevel(user.level)
        : null;
      if (!initialPage) throw new Error("Page access runtime is unavailable");
      window.OI_MODERN_APP.bootstrap({
        user,
        chatbotData: window.CHATBOT_DATA || {},
        sheetReportData: window.SHEET_REPORT_DATA || {},
        productKeywords: window.PRODUCT_KEYWORDS || {},
        language,
        llmEnabled: window.__OI_LLM_ENABLED !== false,
        agentEnabled: window.__OI_AGENT_ENABLED !== false
      });
      if (!modernAppRoot || typeof window.OI_MODERN_APP.mountApplication !== "function") {
        throw new Error("Modern application root is unavailable");
      }
      if (!window.OI_MODERN_APP.mountApplication(modernAppRoot, initialPage)) {
        throw new Error("Modern application mount failed");
      }
      document.body.classList.add("modern-only");
      loadingProgress.finish("Dashboard ready", "Modern workspace is ready");
      return true;
    } catch (error) {
      console.warn("Modern frontend unavailable; showing the startup error state.", error);
      showModernError(error);
      return false;
    }
  }

  let _dataLoading = false;

  async function loadDashboardAssets() {
    if (_dataLoading) return;  // already loading
    _dataLoading = true;
    const user = currentAuthUser();
    if (!user) {
      _dataLoading = false;
      throw new Error("Authenticated user is unavailable");
    }
    if (user.level === 2) {
      window.CHATBOT_DATA = { summary: {}, offers: [], paymentRecords: [] };
      window.SHEET_REPORT_DATA = { sheets: [], tierSheets: [] };
      window.PRODUCT_KEYWORDS = { merchants: [] };
      loadingProgress.set(78, "Opening Google Ads workspace…", "Offer data is not required for this access level");
      setStatus("", "");
      loadingProgress.driftTo(94, "Building Google Ads workspace…", "Applying your access level");
      try {
        await loadModernApp();
      } finally {
        _dataLoading = false;
      }
      return;
    }
    setStatus("Loading offer data from database", "muted");
    loadingProgress.set(12, "Connecting to offer database…", "Preparing secure access");
    loadingProgress.driftTo(68, "Loading offer records…", "Merchant, performance, and payment data");
    try {
      const offersResp = await fetchJson("/api/ui/db/offers");
      // product keyword data (productTitles / productKeywords) loaded lazily
      // in background after the dashboard renders — see loadOfferKeywords()

      window.CHATBOT_DATA = {
        summary: offersResp.summary || {},
        offers: offersResp.offers || [],
        paymentRecords: offersResp.paymentRecords || [],
        startDate: offersResp.startDate || "",
        endDate: offersResp.endDate || "",
        sources: {
          mode: "db",
          month: offersResp.month,
          startDate: offersResp.startDate || "",
          endDate: offersResp.endDate || "",
          checkedAt: offersResp.checkedAt || null
        }
      };

      window.SHEET_REPORT_DATA = {
        startDate: offersResp.startDate || "",
        endDate: offersResp.endDate || "",
        sheets: offersResp.sheets || [],
        tierSheets: ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]
      };

      window.PRODUCT_KEYWORDS = { merchants: [] };  // loaded lazily
      const offerCount = window.CHATBOT_DATA.offers.length.toLocaleString();
      loadingProgress.set(78, "Offer data received", `${offerCount} offers ready to index`);
    } catch (_err) {
      if (authRefreshInFlight || !currentAuthUser()) {
        _dataLoading = false;
        return;
      }
      // Fallback: empty data
      window.CHATBOT_DATA = { summary: {}, offers: [] };
      window.SHEET_REPORT_DATA = { sheets: [], tierSheets: [] };
      window.PRODUCT_KEYWORDS = { merchants: [] };
      loadingProgress.set(78, "Opening dashboard with limited data…", "Offer data is temporarily unavailable");
    }
    setStatus("", "");
    loadingProgress.driftTo(94, "Building dashboard…", "Applying filters and preparing report views");
    try {
      await loadModernApp();
    } finally {
      _dataLoading = false;
    }

    // Background: load keyword data after dashboard renders
    // (not awaited — non-blocking)
    loadOfferKeywords().catch(function () {});
  }

  /** Lazy-load product keyword data for chatbot keyword search. */
  async function loadOfferKeywords() {
    if (window.__OFFER_KEYWORDS_LOADED) return;
    try {
      const kwResp = await fetchJson("/api/ui/db/keywords");
      window.PRODUCT_KEYWORDS = kwResp;
      window.__OFFER_KEYWORDS_LOADED = true;
    } catch (_err) {
      // Keywords unavailable — attempt to be non-fatal;
      // chatbot keyword search will degrade gracefully.
    }
  }

  function bindLogout() {
    const logout = document.getElementById("modernLogoutButton") || document.getElementById("logoutButton");
    if (!logout) return;
    logout.addEventListener("click", async () => {
      logout.disabled = true;
      try {
        await fetchJson("/api/auth/logout", { method: "POST" });
      } catch (_error) {
        // A failed logout call still gets a clean local reset through reload.
      }
      clearModernSessionState();
      window.location.reload();
    });
  }

  async function unlockDashboard() {
    // Immediately reveal the app shell — don't wait for data
    hideAuthThen(() => {
      if (authShell) authShell.classList.add("hidden");
      if (appShell) appShell.classList.remove("hidden");
      document.body.classList.remove("auth-pending");
      setStatus("", "");
    });

    // Always kick off data loading (guarded against double-load)
    await loadDashboardAssets();
    bindLogout();
  }

  async function handleAuthFailure(event) {
    const failureStatus = event?.detail?.status;
    if (failureStatus !== 401 && failureStatus !== 403) return;
    if (authRefreshInFlight) return;
    authRefreshInFlight = true;
    try {
      if (failureStatus === 401) {
        clearModernSessionState();
        showLoginShell();
        return;
      }
      if (!currentAuthUser()) return;
      const session = await fetchJson("/api/auth/session");
      setAuthUser(session.user);
      window.location.reload();
    } catch (_error) {
      clearModernSessionState();
      showLoginShell();
    } finally {
      authRefreshInFlight = false;
    }
  }

  async function checkSession() {
    try {
      const session = await fetchJson("/api/auth/session");
      setAuthUser(session.user);
      window.__OI_LLM_ENABLED = session.llmEnabled !== false;
      window.__OI_AGENT_ENABLED = session.agentEnabled !== false;
      window.OI_COPILOTKIT_RUNTIME = session.agentRuntime || {
        enabled: false,
        endpoint: "/api/copilotkit",
        authority: "python-registry",
        fallback: "modern"
      };
      await unlockDashboard();
    } catch (error) {
      if (error.status === 503) {
        setStatus("Login environment variables are missing on this server.", "error");
      } else {
        setStatus("", "");
      }
      if (authShell) authShell.classList.remove("hidden");
      if (appShell) appShell.classList.add("hidden");
      document.body.classList.add("auth-pending");
      if (username) username.focus();
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setStatus("", "");
    try {
      const loginResult = await fetchJson("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          username: username ? username.value.trim() : "",
          password: password ? password.value : ""
        })
      });
      window.__OI_LLM_ENABLED = loginResult.llmEnabled !== false;
      window.__OI_AGENT_ENABLED = loginResult.agentEnabled !== false;
      setAuthUser(loginResult.user);
      window.OI_COPILOTKIT_RUNTIME = loginResult.agentRuntime || {
        enabled: false,
        endpoint: "/api/copilotkit",
        authority: "python-registry",
        fallback: "modern"
      };
      if (password) password.value = "";
      await unlockDashboard();
    } catch (error) {
      setStatus(error.message || "Access check failed", "error");
      animateError();
      if (password) password.select();
    } finally {
      setLoading(false);
    }
  }

  async function initAuth() {
    modernAppErrorRetry?.addEventListener("click", () => window.location.reload());
    window.addEventListener("oi-auth-failure", handleAuthFailure);
    if (form) form.addEventListener("submit", handleSubmit);
    await waitForGsap(700);
    animateIntro();
    await checkSession();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAuth);
  } else {
    initAuth();
  }
})();
