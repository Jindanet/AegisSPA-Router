# AegisSPA Router 🛡️

**A production-grade SPA Router for server-rendered web applications**  
Built for dashboards, admin panels, and long-running apps — without heavy frameworks.

> SPA experience. Server-rendered control. Zero framework lock-in.

---

## ✨ Why AegisSPA?

เว็บสมัยใหม่ไม่จำเป็นต้องใช้ React / Vue เสมอไป  
AegisSPA Router ถูกออกแบบมาเพื่อให้เว็บแบบ Server-rendered ได้ประสบการณ์แบบ SPA  
โดยยังคงควบคุมโครงสร้าง HTML และ Backend ได้เต็มที่

นี่คือ Router ที่สร้างมาเพื่อ Production จริง ไม่ใช่แค่ demo

---

## 🚀 Features

- ⚡ SPA Navigation (ไม่ reload ทั้งหน้า)
- 🧠 LRU Cache + TTL ป้องกัน stale content
- 🔄 Abortable Fetch + Retry + Timeout
- 🛡️ CSP-Safe Script Execution (ไม่ใช้ eval)
- 📦 รองรับ ES Module และ External Script
- 📡 Offline / Online Detection
- 🎯 Device-aware UX (ลด animation บนอุปกรณ์ช้า)
- 📊 Auto cleanup (Chart.js / memory leak safe)
- 🧹 Full lifecycle destroy
- 🧩 Event-driven architecture
- 🔥 Graceful fallback (reload เมื่อ SPA fail)

---

## 🏗️ Built For

- Admin Dashboard
- ERP / CRM
- SaaS Backend
- Legacy PHP / Laravel / Rails
- Content-heavy Web
- Long-running browser session

---

## 📦 Installation

```html
<script src="/js/aegis-spa-router.js"></script>
```

---

## 🧩 Basic Usage

```html
<div class="flex-1 overflow-y-auto">
  <div data-spa-container>
    <!-- SPA content -->
  </div>
</div>

<script>
  window.spaRouter = new SPARouter({
    DEBUG: false
  });
</script>
```

---

## 🔗 Navigation

```html
<a href="/dashboard">Dashboard</a>
<a href="/users">Users</a>
```

---

## ⚡ Smart Prefetch

```js
spaRouter.prefetch('/reports');
```

---

## 🧠 Cache Control

```js
spaRouter.clearCache();
spaRouter.getMetrics();
```

---

## 📡 Events

```js
window.addEventListener('spa:afterNavigate', e => {
  console.log('Loaded:', e.detail.path);
});
```

---

## 🛡️ Security & CSP

- ไม่ใช้ eval
- รองรับ strict CSP

---

## 🧹 Destroy

```js
spaRouter.destroy();
```

---

## 📄 License

MIT License

---

## ⭐ Support

If this project helps you, please give it a star ⭐
