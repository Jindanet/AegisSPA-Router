/**
 * AegisSPA Router
 * Production-Grade SPA Router for Server-Rendered Applications
 *
 * Repository:
 * https://github.com/Jindanet/AegisSPA-Router
 *
 * Overview:
 * A lightweight yet powerful client-side SPA router designed for
 * server-rendered web applications. Built to deliver SPA-like navigation
 * without requiring heavy frameworks such as React or Vue.
 *
 * Key Features:
 * - LRU Cache with TTL (stale-safe content management)
 * - Abortable fetch requests (AbortController)
 * - Retry logic with exponential backoff
 * - Memory leak prevention & full lifecycle cleanup
 * - Device-aware animations (adaptive UX)
 * - Chart.js automatic instance cleanup
 * - External script deduplication
 * - ES Module & dynamic script support
 * - Offline / Online detection
 * - Performance & navigation metrics
 * - Graceful fallback to full page reload
 *
 * Security & CSP Notes:
 * - Does NOT use eval() or new Function()
 * - Inline scripts are executed via DOM <script> injection
 * - Compatible with strict Content-Security-Policy (CSP)
 * - Does NOT require 'unsafe-eval'
 * - Inline scripts still require 'unsafe-inline' or nonce/hash
 *   in the script-src directive
 *
 * Design Philosophy:
 * - Framework-agnostic
 * - Server-rendered first
 * - Explicit control over abstraction
 * - Production stability over convenience
 *
 * License:
 * MIT
 *
 * @project   AegisSPA Router
 * @author    Jindanet
 */

(function(window, document) {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════════════════
    
    const CONFIG = Object.freeze({
        // Cache settings
        CACHE_MAX_SIZE: 5,
        CACHE_TTL_MS: 5 * 60 * 1000,  // 5 minutes
        
        // Timing
        PREFETCH_DELAY_MS: 150,
        ANIMATION_DURATION_MS: 150,
        FETCH_TIMEOUT_MS: 10000,
        
        // Retry settings
        MAX_RETRIES: 2,
        RETRY_BASE_DELAY_MS: 1000,
        
        // Selectors
        CONTAINER_SELECTOR: '.flex-1.overflow-y-auto>div',
        NAV_ITEM_SELECTOR: '.nav-item',
        
        // Path validation (exact segment matching)
        FORBIDDEN_PATH_SEGMENTS: ['api', 'logout'],
        FORBIDDEN_PATH_PREFIXES: ['/api/', '/logout'],
        FORBIDDEN_EXACT_PATHS: ['/api', '/logout'],
        
        // Debug mode (set to true for detailed error info)
        DEBUG: false,
        
        // Events
        EVENTS: Object.freeze({
            BEFORE_NAVIGATE: 'spa:beforeNavigate',
            AFTER_NAVIGATE: 'spa:afterNavigate',
            CONTENT_LOADED: 'spa:contentLoaded',
            ERROR: 'spa:error',
            CACHE_HIT: 'spa:cacheHit',
            CACHE_MISS: 'spa:cacheMiss',
            CACHE_CLEARED: 'spa:cacheCleared',
            PREFETCH_START: 'spa:prefetchStart',
            PREFETCH_COMPLETE: 'spa:prefetchComplete',
            ONLINE: 'spa:online',
            OFFLINE: 'spa:offline'
        })
    });

    // ═══════════════════════════════════════════════════════════════════════
    // UTILITY CLASSES
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * LRU Cache with TTL support
     * Efficient memory management with automatic eviction
     */
    class LRUCache {
        constructor(maxSize, ttlMs) {
            this._maxSize = maxSize;
            this._ttlMs = ttlMs;
            this._cache = new Map();
            this._timestamps = new Map();
        }

        get(key) {
            if (!this._cache.has(key)) return null;
            
            // Check freshness
            const timestamp = this._timestamps.get(key);
            if (Date.now() - timestamp > this._ttlMs) {
                this.delete(key);
                return null;
            }
            
            // Move to end (most recently used)
            const value = this._cache.get(key);
            this._cache.delete(key);
            this._cache.set(key, value);
            
            return value;
        }

        set(key, value) {
            // Delete if exists (to update position)
            if (this._cache.has(key)) {
                this._cache.delete(key);
            }
            // Evict oldest if at capacity
            else if (this._cache.size >= this._maxSize) {
                const oldestKey = this._cache.keys().next().value;
                this.delete(oldestKey);
            }
            
            this._cache.set(key, value);
            this._timestamps.set(key, Date.now());
        }

        has(key) {
            if (!this._cache.has(key)) return false;
            
            const timestamp = this._timestamps.get(key);
            if (Date.now() - timestamp > this._ttlMs) {
                this.delete(key);
                return false;
            }
            
            return true;
        }

        delete(key) {
            this._cache.delete(key);
            this._timestamps.delete(key);
        }

        clear() {
            this._cache.clear();
            this._timestamps.clear();
        }

        get size() {
            return this._cache.size;
        }

        getStats() {
            return {
                size: this._cache.size,
                maxSize: this._maxSize,
                keys: Array.from(this._cache.keys())
            };
        }
    }

    /**
     * Script Loader with deduplication and ES Module support
     * 
     * Executes scripts by creating <script> elements - this approach:
     * - Does NOT require 'unsafe-eval' in CSP
     * - Supports type="module" scripts
     * - Properly handles script execution order
     */
    class ScriptLoader {
        constructor(debug = false) {
            this._loaded = new Set();
            this._loading = new Map();
            this._debug = debug;
        }

        /**
         * Load an external script (with deduplication)
         * @param {string} src - Script URL
         * @param {string} [type] - Script type (e.g., 'module')
         */
        async loadExternal(src, type = null) {
            const cacheKey = `${type || 'classic'}:${src}`;
            
            // Already loaded
            if (this._loaded.has(cacheKey)) {
                return Promise.resolve();
            }
            
            // Currently loading - return existing promise
            if (this._loading.has(cacheKey)) {
                return this._loading.get(cacheKey);
            }
            
            // Check if already in DOM (same src and type)
            const existingScript = document.querySelector(
                type === 'module' 
                    ? `script[type="module"][src="${src}"]`
                    : `script:not([type="module"])[src="${src}"]`
            );
            if (existingScript) {
                this._loaded.add(cacheKey);
                return Promise.resolve();
            }
            
            // Create load promise
            const loadPromise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = src;
                if (type) script.type = type;
                script.async = true;
                
                script.onload = () => {
                    this._loaded.add(cacheKey);
                    this._loading.delete(cacheKey);
                    resolve();
                };
                
                script.onerror = () => {
                    this._loading.delete(cacheKey);
                    reject(new Error(`Failed to load script: ${src}`));
                };
                
                document.head.appendChild(script);
            });
            
            this._loading.set(cacheKey, loadPromise);
            return loadPromise;
        }

        /**
         * Execute inline script safely using DOM insertion
         * This method does NOT use eval() or new Function()
         * 
         * @param {string} code - Script content
         * @param {string} [type] - Script type (e.g., 'module')
         * @returns {Promise<void>}
         */
        executeInline(code, type = null) {
            return new Promise((resolve, reject) => {
                if (!code || !code.trim()) {
                    resolve();
                    return;
                }

                const script = document.createElement('script');
                if (type) script.type = type;
                
                // For modules, we need to wait for execution
                if (type === 'module') {
                    // Create a unique marker to detect completion
                    const markerId = `__spa_module_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                    
                    // Append completion marker to module code
                    const wrappedCode = `${code}\nwindow['${markerId}'] = true;`;
                    script.textContent = wrappedCode;
                    
                    // Check for completion
                    const checkComplete = () => {
                        if (window[markerId]) {
                            delete window[markerId];
                            resolve();
                        } else {
                            requestAnimationFrame(checkComplete);
                        }
                    };
                    
                    script.onerror = (e) => {
                        this._handleScriptError(e, code);
                        resolve(); // Don't reject - continue with other scripts
                    };
                    
                    document.head.appendChild(script);
                    requestAnimationFrame(checkComplete);
                } else {
                    // Classic scripts execute synchronously when appended
                    script.textContent = code;
                    
                    try {
                        document.head.appendChild(script);
                        // Remove immediately to keep DOM clean
                        script.remove();
                        resolve();
                    } catch (error) {
                        this._handleScriptError(error, code);
                        resolve(); // Don't reject - continue with other scripts
                    }
                }
            });
        }

        /**
         * Handle script execution errors
         * @private
         */
        _handleScriptError(error, code) {
            const message = error?.message || String(error);
            
            // Ignore common redeclaration errors
            if (this._isRedeclarationError(message)) {
                return;
            }
            
            if (this._debug) {
                console.warn('[SPARouter] Script execution error:', {
                    message,
                    stack: error?.stack,
                    codePreview: code.slice(0, 200) + (code.length > 200 ? '...' : '')
                });
            } else {
                console.warn('[SPARouter] Script execution error:', message);
            }
        }

        _isRedeclarationError(message) {
            if (!message) return false;
            const msg = message.toLowerCase();
            return msg.includes('already been declared') ||
                   msg.includes('already defined') ||
                   msg.includes('redeclaration') ||
                   msg.includes('identifier') && msg.includes('already');
        }

        clear() {
            this._loading.clear();
        }
    }

    /**
     * Link Validator
     * Determines if a link should be handled by SPA router
     * Uses strict path segment matching to avoid false positives
     */
    class LinkValidator {
        /**
         * @param {Object} config - Validation configuration
         * @param {string[]} config.forbiddenPathSegments - Path segments to block (e.g., ['api'] blocks '/api' and '/v1/api')
         * @param {string[]} config.forbiddenPathPrefixes - Path prefixes to block (e.g., ['/api/'] blocks '/api/users')
         * @param {string[]} config.forbiddenExactPaths - Exact paths to block
         * @param {string[]} [config.allowlist] - Paths that are always allowed (overrides forbidden)
         */
        constructor(config) {
            this._forbiddenSegments = new Set(config.forbiddenPathSegments || []);
            this._forbiddenPrefixes = config.forbiddenPathPrefixes || [];
            this._forbiddenExact = new Set(config.forbiddenExactPaths || []);
            this._allowlist = new Set(config.allowlist || []);
        }

        isNavigable(href, currentPath) {
            if (!href) return false;
            
            // Hash links
            if (href.charAt(0) === '#') return false;
            
            // External links
            if (this._isExternalProtocol(href)) return false;
            
            // Check allowlist first (takes precedence)
            if (this._allowlist.has(href)) return true;
            
            // Check forbidden patterns
            if (this._isForbidden(href)) return false;
            
            // Same page
            if (href === currentPath) return false;
            
            return true;
        }

        _isExternalProtocol(href) {
            // Protocol-relative URL
            if (href.startsWith('//')) return true;
            
            // Check for common protocols
            const protocolMatch = href.match(/^([a-z][a-z0-9+.-]*):\/?\/?/i);
            if (protocolMatch) {
                const protocol = protocolMatch[1].toLowerCase();
                return ['http', 'https', 'javascript', 'mailto', 'tel', 'ftp', 'file'].includes(protocol);
            }
            
            return false;
        }

        _isForbidden(href) {
            // Normalize path (remove query string and hash for checking)
            const pathOnly = href.split(/[?#]/)[0].toLowerCase();
            
            // Check exact matches
            if (this._forbiddenExact.has(pathOnly)) return true;
            
            // Check prefixes
            for (const prefix of this._forbiddenPrefixes) {
                if (pathOnly.startsWith(prefix)) return true;
            }
            
            // Check segments (split by '/' and check each segment)
            const segments = pathOnly.split('/').filter(Boolean);
            for (const segment of segments) {
                if (this._forbiddenSegments.has(segment)) return true;
            }
            
            return false;
        }

        /**
         * Add paths to allowlist at runtime
         */
        addToAllowlist(...paths) {
            paths.forEach(p => this._allowlist.add(p));
        }

        /**
         * Add forbidden segments at runtime
         */
        addForbiddenSegment(...segments) {
            segments.forEach(s => this._forbiddenSegments.add(s.toLowerCase()));
        }
    }

    /**
     * Device Capability Detector
     */
    class DeviceCapability {
        constructor() {
            this._capability = this._detect();
        }

        get level() {
            const override = document.body?.dataset?.deviceCapability;
            return override || this._capability;
        }

        get isLow() {
            return this.level === 'low';
        }

        get animationDuration() {
            switch (this.level) {
                case 'low': return 0;
                case 'medium': return 100;
                default: return CONFIG.ANIMATION_DURATION_MS;
            }
        }

        _detect() {
            if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
                return 'low';
            }
            
            const cores = navigator.hardwareConcurrency || 4;
            if (cores <= 2) return 'low';
            if (cores <= 4) return 'medium';
            
            const memory = navigator.deviceMemory;
            if (memory && memory < 4) return 'medium';
            
            return 'high';
        }
    }

    /**
     * Error wrapper with additional context for debugging
     */
    class SPAError extends Error {
        constructor(message, context = {}) {
            super(message);
            this.name = 'SPAError';
            this.context = context;
            this.timestamp = Date.now();
        }

        toJSON() {
            return {
                name: this.name,
                message: this.message,
                context: this.context,
                timestamp: this.timestamp,
                stack: this.stack
            };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MAIN ROUTER CLASS
    // ═══════════════════════════════════════════════════════════════════════

    class SPARouter {
        constructor(options = {}) {
            // Merge options with defaults
            this._config = { ...CONFIG, ...options };
            
            // Initialize utilities
            this._cache = new LRUCache(
                this._config.CACHE_MAX_SIZE,
                this._config.CACHE_TTL_MS
            );
            this._scriptLoader = new ScriptLoader(this._config.DEBUG);
            this._linkValidator = new LinkValidator({
                forbiddenPathSegments: this._config.FORBIDDEN_PATH_SEGMENTS,
                forbiddenPathPrefixes: this._config.FORBIDDEN_PATH_PREFIXES,
                forbiddenExactPaths: this._config.FORBIDDEN_EXACT_PATHS,
                allowlist: this._config.ALLOWLIST
            });
            this._device = new DeviceCapability();
            
            // State
            this._isTransitioning = false;
            this._abortController = null;
            this._prefetchTimer = null;
            this._activeCharts = new Set();
            
            // DOM references
            this._dom = {
                container: null,
                style: null
            };
            
            // Bound handlers
            this._boundHandlers = {
                click: this._handleClick.bind(this),
                popstate: this._handlePopState.bind(this),
                mouseover: this._handleMouseOver.bind(this),
                online: this._handleOnline.bind(this),
                offline: this._handleOffline.bind(this)
            };
            
            // Online status
            this._isOnline = navigator.onLine;
            
            // Performance metrics
            this._metrics = {
                navigations: 0,
                cacheHits: 0,
                cacheMisses: 0,
                prefetches: 0,
                errors: 0,
                avgLoadTime: 0,
                totalLoadTime: 0,
                lastError: null
            };
            
            // Initialize
            this._init();
        }

        // ─────────────────────────────────────────────────────────────────────
        // PUBLIC API
        // ─────────────────────────────────────────────────────────────────────

        async navigate(path) {
            if (this._isTransitioning) return false;
            if (!this._linkValidator.isNavigable(path, this.currentPath)) return false;
            
            return this._navigate(path);
        }

        async prefetch(path) {
            if (this._cache.has(path)) return true;
            if (!this._linkValidator.isNavigable(path, this.currentPath)) return false;
            
            this._emit(CONFIG.EVENTS.PREFETCH_START, { path });
            
            try {
                const html = await this._fetch(path);
                this._cache.set(path, html);
                this._metrics.prefetches++;
                this._emit(CONFIG.EVENTS.PREFETCH_COMPLETE, { path, success: true });
                return true;
            } catch (error) {
                this._emit(CONFIG.EVENTS.PREFETCH_COMPLETE, { path, success: false, error: error.message });
                return false;
            }
        }

        clearCache() {
            const previousSize = this._cache.size;
            const previousKeys = this._cache.getStats().keys;
            this._cache.clear();
            this._emit(CONFIG.EVENTS.CACHE_CLEARED, { 
                previousSize, 
                clearedPaths: previousKeys 
            });
        }

        getMetrics() {
            return {
                ...this._metrics,
                cacheStats: this._cache.getStats(),
                deviceCapability: this._device.level,
                isOnline: this._isOnline
            };
        }

        /**
         * Get link validator for runtime configuration
         */
        get linkValidator() {
            return this._linkValidator;
        }

        /**
         * Enable/disable debug mode
         */
        setDebug(enabled) {
            this._config.DEBUG = enabled;
            this._scriptLoader._debug = enabled;
        }

        destroy() {
            this._abortController?.abort();
            clearTimeout(this._prefetchTimer);
            
            document.removeEventListener('click', this._boundHandlers.click, true);
            document.removeEventListener('mouseover', this._boundHandlers.mouseover, true);
            window.removeEventListener('popstate', this._boundHandlers.popstate);
            window.removeEventListener('online', this._boundHandlers.online);
            window.removeEventListener('offline', this._boundHandlers.offline);
            
            this._destroyCharts();
            this._dom.style?.remove();
            this._cache.clear();
            this._scriptLoader.clear();
            this._activeCharts.clear();
            this._dom.container = null;
            this._dom.style = null;
            
            if (window.spaRouter === this) {
                delete window.spaRouter;
            }
            
            console.info('[SPARouter] Destroyed');
        }

        get currentPath() {
            return location.pathname + location.search;
        }

        get isOnline() {
            return this._isOnline;
        }

        // ─────────────────────────────────────────────────────────────────────
        // INITIALIZATION
        // ─────────────────────────────────────────────────────────────────────

        _init() {
            this._dom.container = document.querySelector(this._config.CONTAINER_SELECTOR);
            
            if (!this._dom.container) {
                console.error('[SPARouter] Container not found:', this._config.CONTAINER_SELECTOR);
                return;
            }
            
            this._injectStyles();
            history.replaceState({ path: this.currentPath, spa: true }, '', this.currentPath);
            
            document.addEventListener('click', this._boundHandlers.click, true);
            document.addEventListener('mouseover', this._boundHandlers.mouseover, { passive: true, capture: true });
            window.addEventListener('popstate', this._boundHandlers.popstate);
            window.addEventListener('online', this._boundHandlers.online);
            window.addEventListener('offline', this._boundHandlers.offline);
            
            if (this._config.DEBUG) {
                console.info('[SPARouter] Initialized', {
                    container: this._config.CONTAINER_SELECTOR,
                    device: this._device.level,
                    cacheSize: this._config.CACHE_MAX_SIZE
                });
            }
        }

        _injectStyles() {
            if (document.getElementById('spa-router-styles')) return;
            
            const duration = this._device.animationDuration;
            const style = document.createElement('style');
            style.id = 'spa-router-styles';
            style.textContent = `
                ${this._config.CONTAINER_SELECTOR} {
                    transition: opacity ${duration}ms ease, transform ${duration}ms ease;
                    will-change: opacity, transform;
                    contain: layout style paint;
                }
                .spa-loading {
                    opacity: 0.7;
                    pointer-events: none;
                }
            `;
            document.head.appendChild(style);
            this._dom.style = style;
        }

        // ─────────────────────────────────────────────────────────────────────
        // EVENT HANDLERS
        // ─────────────────────────────────────────────────────────────────────

        _handleClick(event) {
            const link = event.target.closest('a');
            if (!link) return;
            
            const href = link.getAttribute('href');
            if (!this._linkValidator.isNavigable(href, this.currentPath)) return;
            
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            if (event.button !== 0) return;
            
            event.preventDefault();
            event.stopPropagation();
            
            this._navigate(href);
        }

        _handlePopState(event) {
            if (event.state?.spa && event.state?.path) {
                this._load(event.state.path, false);
            }
        }

        _handleMouseOver(event) {
            if (this._device.isLow) return;
            
            const link = event.target.closest(`a${this._config.NAV_ITEM_SELECTOR}`);
            if (!link) return;
            
            const href = link.getAttribute('href');
            if (!this._linkValidator.isNavigable(href, this.currentPath)) return;
            
            clearTimeout(this._prefetchTimer);
            this._prefetchTimer = setTimeout(() => {
                this.prefetch(href);
            }, this._config.PREFETCH_DELAY_MS);
        }

        _handleOnline() {
            this._isOnline = true;
            this._emit(CONFIG.EVENTS.ONLINE);
        }

        _handleOffline() {
            this._isOnline = false;
            this._emit(CONFIG.EVENTS.OFFLINE);
        }

        // ─────────────────────────────────────────────────────────────────────
        // NAVIGATION
        // ─────────────────────────────────────────────────────────────────────

        async _navigate(path) {
            if (this._isTransitioning) return false;
            
            this._isTransitioning = true;
            const startTime = performance.now();
            
            const beforeEvent = this._emit(CONFIG.EVENTS.BEFORE_NAVIGATE, { path }, true);
            if (beforeEvent.defaultPrevented) {
                this._isTransitioning = false;
                return false;
            }
            
            try {
                await this._load(path, true);
                history.pushState({ path, spa: true }, '', path);
                
                this._metrics.navigations++;
                const loadTime = performance.now() - startTime;
                this._metrics.totalLoadTime += loadTime;
                this._metrics.avgLoadTime = this._metrics.totalLoadTime / this._metrics.navigations;
                
                this._emit(CONFIG.EVENTS.AFTER_NAVIGATE, { path, loadTime });
                return true;
                
            } catch (error) {
                this._recordError(error, { path, action: 'navigate' });
                
                console.warn('[SPARouter] Navigation failed, falling back:', error.message);
                location.href = path;
                return false;
                
            } finally {
                this._isTransitioning = false;
            }
        }

        async _load(path, animate) {
            let html;
            
            const cached = this._cache.get(path);
            if (cached) {
                html = cached;
                this._metrics.cacheHits++;
                this._emit(CONFIG.EVENTS.CACHE_HIT, { path });
            } else {
                html = await this._fetchWithRetry(path);
                this._cache.set(path, html);
                this._metrics.cacheMisses++;
                this._emit(CONFIG.EVENTS.CACHE_MISS, { path });
            }
            
            await this._updateDOM(html, animate);
            this._updateNavigation(path);
            
            if (window.scrollY > 0) {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // FETCHING
        // ─────────────────────────────────────────────────────────────────────

        async _fetchWithRetry(path, attempt = 0) {
            try {
                return await this._fetch(path);
            } catch (error) {
                if (attempt < this._config.MAX_RETRIES) {
                    const delay = this._config.RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
                    await this._sleep(delay);
                    return this._fetchWithRetry(path, attempt + 1);
                }
                throw error;
            }
        }

        async _fetch(path) {
            if (!this._isOnline) {
                throw new SPAError('Offline', { path });
            }
            
            this._abortController?.abort();
            this._abortController = new AbortController();
            
            const url = new URL(path, location.origin);
            url.searchParams.set('_spa', Date.now());
            
            const timeoutId = setTimeout(() => {
                this._abortController.abort();
            }, this._config.FETCH_TIMEOUT_MS);
            
            try {
                const response = await fetch(url.href, {
                    method: 'GET',
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                        'Accept': 'text/html',
                        'X-SPA-Request': 'true'
                    },
                    signal: this._abortController.signal,
                    credentials: 'same-origin'
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    throw new SPAError(`HTTP ${response.status}: ${response.statusText}`, {
                        path,
                        status: response.status,
                        statusText: response.statusText
                    });
                }
                
                return await response.text();
                
            } catch (error) {
                clearTimeout(timeoutId);
                
                if (error.name === 'AbortError') {
                    throw new SPAError('Request timeout or cancelled', { path });
                }
                
                if (error instanceof SPAError) throw error;
                
                throw new SPAError(error.message, { path, originalError: error.name });
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // DOM UPDATES
        // ─────────────────────────────────────────────────────────────────────

        async _updateDOM(html, animate) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const newContent = doc.querySelector(this._config.CONTAINER_SELECTOR);
            
            const container = this._dom.container || 
                              document.querySelector(this._config.CONTAINER_SELECTOR);
            
            if (!newContent || !container) {
                throw new SPAError('Container not found in response', {
                    selector: this._config.CONTAINER_SELECTOR,
                    hasNewContent: !!newContent,
                    hasContainer: !!container
                });
            }
            
            const newTitle = doc.querySelector('title')?.textContent;
            if (newTitle) document.title = newTitle;
            
            this._updateMetaTags(doc);
            this._destroyCharts();
            
            if (animate && !this._device.isLow) {
                await this._animateOut(container);
            }
            
            container.innerHTML = newContent.innerHTML;
            this._dom.container = container;
            
            await this._nextFrame();
            await this._runScripts(container);
            this._reinitializeComponents();
            this._animateIn(container);
            
            this._emit(CONFIG.EVENTS.CONTENT_LOADED);
        }

        _updateMetaTags(doc) {
            const newDesc = doc.querySelector('meta[name="description"]');
            const oldDesc = document.querySelector('meta[name="description"]');
            if (newDesc && oldDesc) {
                oldDesc.setAttribute('content', newDesc.getAttribute('content') || '');
            }
            
            const newCanonical = doc.querySelector('link[rel="canonical"]');
            const oldCanonical = document.querySelector('link[rel="canonical"]');
            if (newCanonical && oldCanonical) {
                oldCanonical.setAttribute('href', newCanonical.getAttribute('href') || '');
            }
        }

        async _animateOut(element) {
            element.style.opacity = '0';
            element.style.transform = 'translateY(-10px)';
            await this._sleep(this._device.animationDuration);
        }

        _animateIn(element) {
            element.style.opacity = '1';
            element.style.transform = 'translateY(0)';
        }

        /**
         * Run scripts from new content
         * Handles both classic scripts and ES modules
         */
        async _runScripts(container) {
            const scripts = container.querySelectorAll('script');
            
            for (const script of scripts) {
                const type = script.getAttribute('type');
                const isModule = type === 'module';
                
                if (script.src) {
                    // External script
                    try {
                        await this._scriptLoader.loadExternal(script.src, isModule ? 'module' : null);
                    } catch (error) {
                        if (this._config.DEBUG) {
                            console.warn('[SPARouter] Failed to load script:', script.src, error);
                        }
                    }
                } else if (script.textContent?.trim()) {
                    // Inline script
                    await this._scriptLoader.executeInline(script.textContent, isModule ? 'module' : null);
                }
            }
        }

        _reinitializeComponents() {
            if (window.Chart) {
                Chart.defaults.animation = this._device.isLow 
                    ? false 
                    : { duration: this._device.level === 'medium' ? 400 : 750 };
                
                if (Chart.instances) {
                    for (const chart of Object.values(Chart.instances)) {
                        this._activeCharts.add(chart);
                    }
                }
            }
        }

        _destroyCharts() {
            for (const chart of this._activeCharts) {
                try {
                    chart.destroy();
                } catch {
                    // Ignore
                }
            }
            this._activeCharts.clear();
            
            if (window.Chart?.instances) {
                const instances = Object.values(Chart.instances);
                for (const instance of instances) {
                    try {
                        instance.destroy();
                    } catch {
                        // Ignore
                    }
                }
            }
        }

        _updateNavigation(path) {
            const items = document.querySelectorAll(this._config.NAV_ITEM_SELECTOR);
            
            for (const item of items) {
                const href = item.getAttribute('href');
                const isActive = href === path || 
                                 (path !== '/' && href !== '/' && path.startsWith(href));
                item.classList.toggle('active', isActive);
            }
        }

        // ─────────────────────────────────────────────────────────────────────
        // ERROR HANDLING
        // ─────────────────────────────────────────────────────────────────────

        _recordError(error, context = {}) {
            this._metrics.errors++;
            
            const errorInfo = {
                message: error.message,
                context: { ...context, ...(error.context || {}) },
                timestamp: Date.now()
            };
            
            if (this._config.DEBUG) {
                errorInfo.stack = error.stack;
            }
            
            this._metrics.lastError = errorInfo;
            
            this._emit(CONFIG.EVENTS.ERROR, errorInfo);
        }

        // ─────────────────────────────────────────────────────────────────────
        // UTILITIES
        // ─────────────────────────────────────────────────────────────────────

        _emit(eventName, detail = {}, cancelable = false) {
            const event = new CustomEvent(eventName, {
                detail,
                bubbles: true,
                cancelable
            });
            window.dispatchEvent(event);
            return event;
        }

        _sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        _nextFrame() {
            return new Promise(resolve => requestAnimationFrame(resolve));
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════

    function init() {
        if (window.spaRouter) return;
        
        window.spaRouter = new SPARouter();
        
        window.SPARouter = SPARouter;
        window.clearSPACache = () => window.spaRouter?.clearCache();
        window.getSPAMetrics = () => window.spaRouter?.getMetrics();
        window.destroySPARouter = () => {
            window.spaRouter?.destroy();
            delete window.SPARouter;
            delete window.clearSPACache;
            delete window.getSPAMetrics;
            delete window.destroySPARouter;
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

})(window, document);
