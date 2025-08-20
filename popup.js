(async () => {
    'use strict';

    const els = {
        hoverEnabled: document.getElementById('hoverEnabled'),
        wageType: document.getElementById('wageType'),
        wage: document.getElementById('wage'),
        hoursPerWeek: document.getElementById('hoursPerWeek'),
        takeHomePercent: document.getElementById('takeHomePercent'),
        debugEnabled: document.getElementById('debugEnabled'),
        wageLabel: document.getElementById('wageLabel'),
        saveBtn: document.getElementById('saveBtn'),
        status: document.getElementById('status')
    };

    const defaults = {
        hoverEnabled: true,
        wageType: 'hourly',
        wage: 20,
        hoursPerWeek: 40,
        takeHomePercent: 70,
        debugEnabled: false
    };

    function applyLabel() {
        els.wageLabel.textContent =
            els.wageType.value === 'annual' ? 'Annual salary ($/yr)' : 'Hourly wage ($/hr)';
    }
    function updateSummary() {
        const wageType = document.getElementById('wageType').value;
        const wage = parseFloat(document.getElementById('wage').value);
        const hoursPerWeek = parseFloat(document.getElementById('hoursPerWeek').value);
        const takeHomePercent = parseFloat(document.getElementById('takeHomePercent').value);

        if (isNaN(wage) || isNaN(hoursPerWeek) || isNaN(takeHomePercent) || wage <= 0) {
            document.getElementById('summarySection').style.display = 'none';
            return;
        }

        let hourlyGross;
        if (wageType === 'hourly') {
            hourlyGross = wage;
        } else {
            hourlyGross = wage / (hoursPerWeek * 52);
        }

        const hourlyNet = hourlyGross * (takeHomePercent / 100);
        const annualNet = (hourlyGross * hoursPerWeek * 52) * (takeHomePercent / 100);

        document.getElementById('summaryHourly').textContent =
            `Effective hourly: $${hourlyNet.toFixed(2)}/hr`;
        document.getElementById('summaryNet').textContent =
            `Net annual pay: $${annualNet.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
        document.getElementById('summarySection').style.display = 'block';
    }


    async function load() {
        const keys = Object.keys(defaults);
        const data = await new Promise(r => chrome.storage.local.get(keys, r));
        const cfg = { ...defaults, ...data };

        els.hoverEnabled.checked = !!cfg.hoverEnabled;
        els.wageType.value = cfg.wageType;
        els.wage.value = String(cfg.wage);
        els.hoursPerWeek.value = String(cfg.hoursPerWeek);
        els.takeHomePercent.value = String(cfg.takeHomePercent);
        els.debugEnabled.checked = !!cfg.debugEnabled;

        applyLabel();
        updateSummary();
    }

    async function save() {
        els.saveBtn.disabled = true;
        els.status.textContent = 'Saving…';

        const payload = {
            hoverEnabled: !!els.hoverEnabled.checked,
            wageType: els.wageType.value,
            wage: Number(els.wage.value || 0),
            hoursPerWeek: Number(els.hoursPerWeek.value || 40),
            takeHomePercent: Number(els.takeHomePercent.value || 70),
            debugEnabled: !!els.debugEnabled.checked
        };

        await new Promise(r => chrome.storage.local.set(payload, r));

        // Notify current tab to refresh settings live
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
            try { await chrome.tabs.sendMessage(tab.id, { action: 'hourvest:settingsUpdated' }); } catch { }
        }

        els.status.textContent = 'Saved';
        setTimeout(() => { els.status.textContent = ''; }, 1100);
        els.saveBtn.disabled = false;
    }

    els.wageType.addEventListener('change', applyLabel);
    els.saveBtn.addEventListener('click', save);
    [els.wageType, els.wage, els.hoursPerWeek, els.takeHomePercent]
        .forEach(el => el.addEventListener('input', updateSummary));

    load();
})();
