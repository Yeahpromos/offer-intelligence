(function () {
  const APP_SCRIPT = "./app.js?v=20260825-revenue-flow-multibrand";
  const AUTH_READY_CLASS = "auth-ready";
  const reduceMotionQuery = "(prefers-reduced-motion: reduce)";

  const authShell = document.getElementById("authShell");
  const appShell = document.getElementById("appShell");
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

  let _dataLoading = false;

  async function loadDashboardAssets() {
    if (_dataLoading) return;  // already loading
    _dataLoading = true;
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
        sources: { mode: "db", month: offersResp.month, startDate: offersResp.startDate || "", endDate: offersResp.endDate || "" }
      };

      window.SHEET_REPORT_DATA = {
        sheets: offersResp.sheets || [],
        tierSheets: ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]
      };

      window.PRODUCT_KEYWORDS = { merchants: [] };  // loaded lazily
      const offerCount = window.CHATBOT_DATA.offers.length.toLocaleString();
      loadingProgress.set(78, "Offer data received", `${offerCount} offers ready to index`);
    } catch (_err) {
      // Fallback: empty data
      window.CHATBOT_DATA = { summary: {}, offers: [] };
      window.SHEET_REPORT_DATA = { sheets: [], tierSheets: [] };
      window.PRODUCT_KEYWORDS = { merchants: [] };
      loadingProgress.set(78, "Opening dashboard with limited data…", "Offer data is temporarily unavailable");
    }
    setStatus("", "");
    loadingProgress.driftTo(94, "Building dashboard…", "Applying filters and preparing report views");
    await loadScript(APP_SCRIPT);

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
      // Notify app.js to merge keyword data into offers
      if (typeof window.__onOfferKeywordsLoaded === "function") {
        window.__onOfferKeywordsLoaded(kwResp);
      }
    } catch (_err) {
      // Keywords unavailable — attempt to be non-fatal;
      // chatbot keyword search will degrade gracefully.
    }
  }

  function bindLogout() {
    const logout = document.getElementById("logoutButton");
    if (!logout) return;
    logout.addEventListener("click", async () => {
      logout.disabled = true;
      try {
        await fetchJson("/api/auth/logout", { method: "POST" });
      } catch (_error) {
        // A failed logout call still gets a clean local reset through reload.
      }
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

  async function checkSession() {
    try {
      const session = await fetchJson("/api/auth/session");
      window.__OI_LLM_ENABLED = session.llmEnabled !== false;
      window.__OI_AGENT_ENABLED = session.agentEnabled !== false;
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
