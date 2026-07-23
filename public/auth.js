(function () {
  const APP_SCRIPT = "./app.js?v=20260723-tier-scroll1";
  const AUTH_READY_CLASS = "auth-ready";
  const reduceMotionQuery = "(prefers-reduced-motion: reduce)";

  const authShell = document.getElementById("authShell");
  const appShell = document.getElementById("appShell");
  const form = document.getElementById("authForm");
  const username = document.getElementById("authUsername");
  const password = document.getElementById("authPassword");
  const submit = document.getElementById("authSubmit");
  const status = document.getElementById("authStatus");

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
    try {
      const offersResp = await fetchJson("/api/ui/db/offers");
      // product keyword data (productTitles / productKeywords) loaded lazily
      // in background after the dashboard renders — see loadOfferKeywords()

      window.CHATBOT_DATA = {
        summary: offersResp.summary || {},
        offers: offersResp.offers || [],
        paymentRecords: offersResp.paymentRecords || [],
        sources: { mode: "db", month: offersResp.month }
      };

      window.SHEET_REPORT_DATA = {
        sheets: offersResp.sheets || [],
        tierSheets: ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]
      };

      window.PRODUCT_KEYWORDS = { merchants: [] };  // loaded lazily
    } catch (_err) {
      // Fallback: empty data
      window.CHATBOT_DATA = { summary: {}, offers: [] };
      window.SHEET_REPORT_DATA = { sheets: [], tierSheets: [] };
      window.PRODUCT_KEYWORDS = { merchants: [] };
    }
    setStatus("", "");
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
