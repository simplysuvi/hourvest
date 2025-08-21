(() => {
    'use strict';

    /** ========================
     *   0) Debug plumbing
     *  ======================== */
    const perf = {
        scans: 0,
        nodesChecked: 0,
        hits: 0,
        lastScanMs: 0,
        resetFrame() { this.nodesChecked = 0; }
    };

    const debug = {
        enabled: false,
        markEl: null,

        setEnabled(v) {
            this.enabled = !!v;
            if (!this.enabled) this.clearMark();
            log('Debug', `enabled=${this.enabled}`);
        },

        group(label, fn) {
            if (!this.enabled) return fn();
            console.groupCollapsed(`%cHourvest%c ${label}`, 'color:#007aff;font-weight:600', 'color:#86868b');
            try { return fn(); } finally { console.groupEnd(); }
        },

        info(...args) { if (this.enabled) console.info('Hourvest:', ...args); },
        warn(...args) { if (this.enabled) console.warn('Hourvest:', ...args); },
        table(obj) { if (this.enabled) console.table(obj); },

        // Draw a refined overlay box around the current match rect
        markRect(rect) {
            if (!this.enabled) return;
            if (!this.markEl) {
                const el = document.createElement('div');
                el.id = 'hourvest-debug-rect';
                el.style.cssText = `
            position: fixed; pointer-events: none; z-index: 2147483647;
            border: 1.5px solid #007aff; 
            background: rgba(0, 122, 255, 0.08);
            border-radius: 6px; 
            transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 0 0 1px rgba(0, 122, 255, 0.2);
        `;
                document.documentElement.appendChild(el);
                this.markEl = el;
            }
            this.markEl.style.left = `${rect.left - 2}px`;
            this.markEl.style.top = `${rect.top - 2}px`;
            this.markEl.style.width = `${rect.width + 4}px`;
            this.markEl.style.height = `${rect.height + 4}px`;
            this.markEl.style.opacity = '1';
        },

        clearMark() {
            if (this.markEl) this.markEl.style.opacity = '0';
        }
    };

    const log = (...a) => debug.enabled && console.log('Hourvest:', ...a);

    /** ========================
     *   1) Config / Utilities
     *  ======================== */
    const CURRENCY_RE =
        /(?:^|[\s(])((?:USD|EUR|GBP|CAD|AUD|JPY|INR|[$€£¥₹]))\s*([0-9]{1,3}(?:[,\u202F\u00A0][0-9]{2,3})*(?:[.,][0-9]{2})?|[0-9]+(?:[.,][0-9]{2})?)(?:\s?(k|m|b|bn|mm|mn))?\b/gi;
    const QUICK_SCAN_RE = /(\$|£|€|¥|₹|USD|EUR|GBP|CAD|AUD|JPY|INR)\s*\d/;

    function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

    // Visible check helper (safe for text nodes)
    function nodeHasRect(node) {
        try {
            if (!node || !node.textContent) return false;
            const r = document.createRange();
            r.setStart(node, 0);
            r.setEnd(node, Math.min(1, node.length ?? 1));
            const rect = r.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        } catch {
            return false;
        }
    }

    function hasStrikeThrough(el) {
        let cur = el;
        for (let i = 0; i < 4 && cur; i++, cur = cur.parentElement) {
            const cs = getComputedStyle(cur);
            const tdl = cs.textDecorationLine || cs.textDecoration;
            if (tdl && tdl.includes('line-through')) return true;
        }
        return false;
    }

    /** ========================
     *   2) Settings
     *  ======================== */
    const settings = {
        defaults: {
            hoverEnabled: true,
            wageType: 'hourly',     // 'hourly' | 'annual'
            wage: 20,
            hoursPerWeek: 40,
            takeHomePercent: 70,
            debugEnabled: false
        },
        cache: null,
        async load() {
            const keys = Object.keys(this.defaults);
            const res = await new Promise((resolve) => chrome.storage.local.get(keys, resolve));
            this.cache = { ...this.defaults, ...res };
            debug.setEnabled(!!this.cache.debugEnabled);
            log('Settings loaded', this.cache);
            return this.cache;
        },
        get(k) { return (this.cache ?? this.defaults)[k]; }
    };

    /** ========================
     *   3) Wage Calculator
     *  ======================== */
    const wageCalculator = {
        getEffectiveHourly() {
            const wageType = settings.get('wageType');
            let wage = Number(settings.get('wage')) || 0;
            const hoursPerWeek = Number(settings.get('hoursPerWeek')) || 40;
            const takeHome = Number(settings.get('takeHomePercent')) || 70;
            if (wage <= 0) return 0;

            let grossHourly = wageType === 'annual'
                ? wage / (hoursPerWeek * 52)
                : wage;

            const eff = grossHourly * (takeHome / 100);
            log('Effective hourly', { wageType, wage, hoursPerWeek, takeHome, eff: eff.toFixed(2) });
            return eff;
        },

        formatComprehensiveTime(amount, hourly) {
            if (hourly <= 0 || amount <= 0) return null;

            const totalMin = Math.round((amount / hourly) * 60);
            if (totalMin < 1) return { primary: 'Less than 1 minute', secondary: 'Almost free!' };

            // Calculate different time representations
            const minutes = totalMin;
            const hours = totalMin / 60;
            const days = totalMin / (60 * 8); // 8-hour workday
            const weeks = totalMin / (60 * 40); // 40-hour workweek

            let primary, secondary, context;

            if (totalMin < 60) {
                primary = `${totalMin} minute${totalMin === 1 ? '' : 's'}`;
                secondary = 'Quick work';
            } else if (hours < 8) {
                const h = Math.floor(hours);
                const m = totalMin % 60;
                primary = m > 0 ? `${h}h ${m}m` : `${h} hour${h === 1 ? '' : 's'}`;
                if (hours < 2) {
                    secondary = 'Part of your morning';
                } else if (hours < 4) {
                    secondary = 'Half your morning';
                } else {
                    secondary = 'Most of your workday';
                }
            } else if (days < 5) {
                const wholeDays = Math.floor(days);
                const remainingHours = Math.round((days - wholeDays) * 8);

                if (wholeDays === 0) {
                    primary = 'Full workday';
                    secondary = '8 hours of work';
                } else if (wholeDays === 1 && remainingHours === 0) {
                    primary = '1 full workday';
                    secondary = '8 hours of work';
                } else if (remainingHours === 0) {
                    primary = `${wholeDays} workdays`;
                    secondary = `${wholeDays * 8} hours of work`;
                } else {
                    primary = wholeDays > 0
                        ? `${wholeDays} day${wholeDays === 1 ? '' : 's'}, ${remainingHours}h`
                        : `${remainingHours} hours`;
                    secondary = `${Math.round(days * 8)} hours of work`;
                }
            } else if (weeks < 4) {
                const wholeWeeks = Math.floor(weeks);
                const remainingDays = Math.round((weeks - wholeWeeks) * 5);

                if (wholeWeeks === 0) {
                    primary = `${remainingDays} workdays`;
                    secondary = 'Almost a work week';
                } else if (remainingDays === 0) {
                    primary = `${wholeWeeks} work week${wholeWeeks === 1 ? '' : 's'}`;
                    secondary = `${wholeWeeks * 40} hours of work`;
                } else {
                    primary = `${wholeWeeks}w ${remainingDays}d`;
                    secondary = `${Math.round(weeks * 40)} hours of work`;
                }
            } else {
                const wholeWeeks = Math.round(weeks);
                primary = `${wholeWeeks} work weeks`;
                secondary = `${Math.round(weeks * 40)} hours of work`;

                if (wholeWeeks > 12) {
                    const months = Math.round(wholeWeeks / 4.33);
                    primary = `${months} month${months === 1 ? '' : 's'} of work`;
                    secondary = `${wholeWeeks} weeks`;
                }
            }

            return { primary, secondary, rawHours: hours };
        }
    };

    /** ========================
     *   4) Tooltip
     *  ======================== */
    const tooltip = {
        el: null,
        ensure() {
            if (!document.getElementById('hourvest-styles')) {
                const style = document.createElement('style');
                style.id = 'hourvest-styles';
                style.textContent = `
        .hourvest-tooltip {
            position: fixed;
            top: 0; left: 0;
            transform: translate(-9999px, -9999px);
            opacity: 0;
            transition: opacity 180ms ease, transform 0ms linear;
            padding: 12px 16px;
            backdrop-filter: saturate(180%) blur(24px);
            -webkit-backdrop-filter: saturate(180%) blur(24px);
            background: rgba(255, 255, 255, 0.92);
            border: 0.5px solid rgba(0, 0, 0, 0.06);
            border-radius: 16px;
            box-shadow: 
                0 16px 48px rgba(0, 0, 0, 0.12),
                0 4px 16px rgba(0, 0, 0, 0.08),
                inset 0 1px 0 rgba(255, 255, 255, 0.7);
            pointer-events: none;
            z-index: 2147483647;
            min-width: 160px;
            max-width: 280px;
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif;
            user-select: none;
            will-change: transform, opacity;
        }
        
        @media (prefers-color-scheme: dark) {
        .hourvest-tooltip {
            background: rgba(28, 28, 30, 0.94);
            border-color: rgba(255, 255, 255, 0.08);
            box-shadow: 
            0 16px 48px rgba(0, 0, 0, 0.5),
            0 4px 16px rgba(0, 0, 0, 0.3),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }
        }
        
        .hourvest-tooltip.show {
            opacity: 1;
            transform: translate(var(--tx, -9999px), var(--ty, -9999px));
            }
        
        .hourvest-tooltip-header {
        display: flex;
        align-items: center;
        margin-bottom: 8px;
        }
        
        .hourvest-tooltip-icon {
        width: 16px;
        height: 16px;
        margin-right: 8px;
        opacity: 0.8;
        font-size: 12px;
        display: flex;
        align-items: center;
        justify-content: center;
        }
        
        .hourvest-tooltip-price {
        font-size: 11px;
        font-weight: 600;
        color: #007aff;
        letter-spacing: -0.01em;
        text-transform: uppercase;
        }
        
        @media (prefers-color-scheme: dark) {
        .hourvest-tooltip-price {
            color: #409cff;
        }
        }
        
        .hourvest-tooltip-primary {
        font-size: 15px;
        font-weight: 700;
        color: #1d1d1f;
        line-height: 1.2;
        margin-bottom: 4px;
        letter-spacing: -0.02em;
        }
        
        .hourvest-tooltip-secondary {
        font-size: 12px;
        font-weight: 500;
        color: #86868b;
        line-height: 1.3;
        letter-spacing: -0.01em;
        }
        
        @media (prefers-color-scheme: dark) {
        .hourvest-tooltip-primary {
            color: #f5f5f7;
        }
        .hourvest-tooltip-secondary {
            color: #a1a1a6;
        }
        }
        
        .hourvest-tooltip::before {
        content: '';
        position: absolute;
        bottom: -6px;
        left: 50%;
        transform: translateX(-50%);
        width: 12px;
        height: 6px;
        background: inherit;
        border-right: 0.5px solid rgba(0, 0, 0, 0.06);
        border-bottom: 0.5px solid rgba(0, 0, 0, 0.06);
        border-radius: 0 0 3px 0;
        clip-path: polygon(0 0, 100% 0, 50% 100%);
        opacity: 0;
        transition: opacity 200ms ease;
        }
        
        @media (prefers-color-scheme: dark) {
        .hourvest-tooltip::before {
            border-right-color: rgba(255, 255, 255, 0.08);
            border-bottom-color: rgba(255, 255, 255, 0.08);
        }
        }
        
        .hourvest-tooltip.show-tail::before {
        opacity: 1;
        }
        `;
                document.head.appendChild(style);
            }

            if (!this.el) {
                this.el = document.createElement('div');
                this.el.className = 'hourvest-tooltip';
                this.el.innerHTML = `
                    <div class="hourvest-tooltip-header">
                        <div class="hourvest-tooltip-icon">⏱</div>
                        <div class="hourvest-tooltip-price"></div>
                    </div>
                    <div class="hourvest-tooltip-primary"></div>
                    <div class="hourvest-tooltip-secondary"></div>
                `;
                document.body.appendChild(this.el);
            }
        },

        updateAt(x, y, timeData, price) {
            if (!this.el || !timeData) return;

            const priceEl = this.el.querySelector('.hourvest-tooltip-price');
            const primaryEl = this.el.querySelector('.hourvest-tooltip-primary');
            const secondaryEl = this.el.querySelector('.hourvest-tooltip-secondary');

            // Format price display
            const formattedPrice = price.toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 0,
                maximumFractionDigits: 2
            });

            priceEl.textContent = formattedPrice;
            primaryEl.textContent = timeData.primary;
            secondaryEl.textContent = timeData.secondary;

            // Dynamic sizing based on content
            this.el.style.width = 'auto';
            const rect = this.el.getBoundingClientRect();
            const tooltipWidth = Math.max(160, rect.width);
            const tooltipHeight = rect.height;

            const pad = 16;
            const tailOffset = 12;

            let tx = x - (tooltipWidth / 2);
            let ty = y - tooltipHeight - pad - tailOffset;
            let showTail = true;

            // Horizontal bounds checking
            if (tx < pad) {
                tx = pad;
            } else if (tx + tooltipWidth > window.innerWidth - pad) {
                tx = window.innerWidth - tooltipWidth - pad;
            }

            // Vertical bounds checking - flip to bottom if needed
            if (ty < pad) {
                ty = y + pad;
                showTail = false; // Don't show tail when flipped
            }

            // Final bounds check
            ty = clamp(ty, pad, window.innerHeight - tooltipHeight - pad);

            this.el.style.setProperty('--tx', `${tx}px`);
            this.el.style.setProperty('--ty', `${ty}px`);

            // Toggle tail visibility
            if (showTail) {
                this.el.classList.add('show-tail');
            } else {
                this.el.classList.remove('show-tail');
            }
        },

        show() {
            if (this.el) {
                // Small delay to ensure smooth animation
                requestAnimationFrame(() => {
                    this.el.classList.add('show');
                });
            }
        },

        hide() {
            if (this.el) {
                this.el.classList.remove('show', 'show-tail');
            }
        }
    };

    /** ========================
     *   5) Hover Engine
     *  ======================== */
    const hoverEngine = {
        _boundMove: null,
        _active: false,
        _rafScheduled: false,
        _lastEvt: null,
        _lastHit: null, // { rect: DOMRect, price: number }

        init() {
            if (!settings.get('hoverEnabled') || this._active) return;
            tooltip.ensure();
            this._boundMove = this.onPointerMove.bind(this);
            document.addEventListener('pointermove', this._boundMove, true);
            this._active = true;
            log('Hover engine ON');
        },

        stop() {
            if (!this._active) return;
            document.removeEventListener('pointermove', this._boundMove, true);
            this._active = false;
            this._lastHit = null;
            tooltip.hide();
            debug.clearMark();
            log('Hover engine OFF');
        },

        onPointerMove(e) {
            if (!settings.get('hoverEnabled')) return;

            // If still inside previous hit rect, just move tooltip and bail.
            if (this._lastHit && this._pointInRect(e.clientX, e.clientY, this._lastHit.rect)) {
                const timeData = wageCalculator.formatComprehensiveTime(this._lastHit.price, wageCalculator.getEffectiveHourly());
                if (timeData) {
                    tooltip.updateAt(e.clientX, e.clientY, timeData, this._lastHit.price);
                }
                return;
            }

            // Left the rect → clear and hide
            if (this._lastHit) {
                this._lastHit = null;
                tooltip.hide();
                debug.clearMark();
            }

            // Throttle heavy work to once per frame
            this._lastEvt = e;
            if (this._rafScheduled) return;
            this._rafScheduled = true;
            requestAnimationFrame(() => {
                this._rafScheduled = false;
                perf.resetFrame();
                const t0 = performance.now();
                this._scanAtPoint(this._lastEvt);
                const t1 = performance.now();
                perf.lastScanMs = +(t1 - t0).toFixed(2);
                debug.group('Scan', () => {
                    debug.info('Target:', e.target);
                    debug.table({
                        scans: ++perf.scans,
                        nodesChecked: perf.nodesChecked,
                        hits: perf.hits,
                        lastScanMs: perf.lastScanMs
                    });
                });
            });
        },

        _scanAtPoint(e) {
            const path = e.composedPath ? e.composedPath() : [e.target];
            const target = path.find(n => n && n.nodeType === 1 && n.textContent && n.textContent.length) || e.target;
            if (!target || !target.textContent) return;

            // Fast-path: bail if no currency token nearby
            const sample = target.textContent.slice(0, 2000);
            if (!QUICK_SCAN_RE.test(sample)) {
                // no currency at all in target → hide tooltip if previously showing
                if (this._lastHit) {
                    this._lastHit = null;
                    tooltip.hide();
                    debug.clearMark();
                }
                return;
            }

            // Walk visible text nodes only
            const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, null);
            let node;
            let checked = 0, MAX = 80; // cap work per frame
            let found = false;

            while ((node = walker.nextNode())) {
                perf.nodesChecked = ++checked;
                if (checked > MAX) break;
                if (!nodeHasRect(node)) continue;

                const hit = this._hitInNode(node, e.clientX, e.clientY);
                if (hit) {
                    this._lastHit = hit;
                    perf.hits++;
                    const effHourly = wageCalculator.getEffectiveHourly();
                    const timeData = wageCalculator.formatComprehensiveTime(hit.price, effHourly);
                    if (timeData) {
                        tooltip.updateAt(e.clientX, e.clientY, timeData, hit.price);
                        tooltip.show();
                        debug.markRect(hit.rect);
                        debug.info('Hit', {
                            price: hit.price,
                            timeData,
                            rect: hit.rect.toJSON?.() ?? hit.rect
                        });
                    }
                    found = true;
                    break;
                }
            }

            // NEW: if no hit was found in this scan, clear tooltip
            if (!found && this._lastHit) {
                this._lastHit = null;
                tooltip.hide();
                debug.clearMark();
            }
        },


        _hitInNode(node, x, y) {
            const text = node.textContent;
            CURRENCY_RE.lastIndex = 0;
            let m;
            while ((m = CURRENCY_RE.exec(text))) {
                const amountStr = m[2];
                const suffix = m[3];
                if (!amountStr) continue;

                // Re-find exact substring window for safe offsets (handles duplicates)
                const start = text.indexOf(amountStr, m.index);
                if (start < 0) continue;
                const end = start + amountStr.length;

                let range;
                try {
                    range = document.createRange();
                    range.setStart(node, start);
                    range.setEnd(node, end);
                } catch {
                    continue;
                }

                const rect = range.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) continue;
                if (!this._pointInRect(x, y, rect)) continue;

                // Skip struck-through "old" prices
                const anchorEl = range.commonAncestorContainer.nodeType === 1
                    ? range.commonAncestorContainer
                    : range.commonAncestorContainer.parentElement;
                if (anchorEl && hasStrikeThrough(anchorEl)) continue;

                const price = this._parseAmount(amountStr, suffix);
                if (isNaN(price) || price <= 0) continue;

                return { rect, price };
            }
            return null;
        },

        _parseAmount(raw, suffix) {
            // Remove thin spaces / NBSP
            let s = (raw || '').replace(/[\u202F\u00A0]/g, '');
            const hasDot = s.includes('.');
            const hasComma = s.includes(',');
            // If both present, rightmost wins as decimal sep
            if (hasDot && hasComma) {
                if (s.lastIndexOf('.') > s.lastIndexOf(',')) {
                    s = s.replace(/,/g, ''); // dot decimal
                } else {
                    s = s.replace(/\./g, '').replace(',', '.'); // comma decimal
                }
            } else if (hasComma) {
                const parts = s.split(',');
                if (parts.length === 2 && parts[1].length === 2) {
                    s = parts[0].replace(/,/g, '') + '.' + parts[1];
                } else {
                    // Likely thousands separator
                    s = s.replace(/,/g, '');
                }
            }
            // Strip everything non-digit/non-dot now
            s = s.replace(/[^0-9.]/g, '');
            const num = parseFloat(s);
            if (debug.enabled) debug.info('parseAmount', { raw, normalized: s, num });
            if (!Number.isFinite(num)) return NaN;

            // NEW: apply suffix multiplier
            let mult = 1;
            if (suffix) {
                switch (suffix.toLowerCase()) {
                    case 'k': mult = 1e3; break;
                    case 'm':
                    case 'mm':
                    case 'mn': mult = 1e6; break;
                    case 'b':
                    case 'bn': mult = 1e9; break;
                }
            }
            return num * mult;
        },

        _pointInRect(x, y, r, tol = 2) {
            return x >= r.left - tol && x <= r.right + tol && y >= r.top - tol && y <= r.bottom + tol;
        }
    };

    /** ========================
     *   6) Boot + Live updates
     *  ======================== */
    async function boot() {
        await settings.load();
        if (settings.get('hoverEnabled')) hoverEngine.init();
        exposeDebugAPI();
    }

    chrome.runtime.onMessage.addListener(async (msg) => {
        if (msg && msg.action === 'hourvest:settingsUpdated') {
            await settings.load();
            if (settings.get('hoverEnabled')) hoverEngine.init();
            else hoverEngine.stop();
        }
    });

    function exposeDebugAPI() {
        // Developer helper hooks
        window.__hourvestDebug = {
            enable() { chrome.storage.local.set({ debugEnabled: true }); debug.setEnabled(true); },
            disable() { chrome.storage.local.set({ debugEnabled: false }); debug.setEnabled(false); },
            stats() { return { ...perf }; },
            clearBox() { debug.clearMark(); }
        };
        debug.info('Debug API available as window.__hourvestDebug');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();