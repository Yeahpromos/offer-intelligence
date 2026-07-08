(function () {
  const DATA_FILES = ["sheet_report_data.js", "chatbot_data.js", "product_keywords.js"];
  const APP_SCRIPT = "./app.js?v=20260708-auth1";
  const AUTH_READY_CLASS = "auth-ready";
  const reduceMotionQuery = "(prefers-reduced-motion: reduce)";
  let booted = false;

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

  async function loadProtectedData(name) {
    const url = `/api/auth/data?file=${encodeURIComponent(name)}&v=20260708-auth1`;
    const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) {
      throw new Error(`Could not load ${name}`);
    }
    const code = await response.text();
    const script = document.createElement("script");
    script.dataset.protectedData = name;
    script.text = code;
    document.head.appendChild(script);
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

  async function loadDashboardAssets() {
    for (const name of DATA_FILES) {
      await loadProtectedData(name);
    }
    await loadScript(APP_SCRIPT);
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
    if (booted) return;
    booted = true;
    setStatus("Loading protected data", "muted");
    await loadDashboardAssets();
    bindLogout();
    hideAuthThen(() => {
      if (authShell) authShell.classList.add("hidden");
      if (appShell) appShell.classList.remove("hidden");
      document.body.classList.remove("auth-pending");
      setStatus("", "");
    });
  }

  async function checkSession() {
    try {
      await fetchJson("/api/auth/session");
      await unlockDashboard();
    } catch (error) {
      booted = false;
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
      await fetchJson("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          username: username ? username.value.trim() : "",
          password: password ? password.value : ""
        })
      });
      if (password) password.value = "";
      await unlockDashboard();
    } catch (error) {
      booted = false;
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
    checkSession();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAuth);
  } else {
    initAuth();
  }
})();
