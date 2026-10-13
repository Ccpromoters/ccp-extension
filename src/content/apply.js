// Content script for application forms (ATS pages): reads the form's questions, fills answers the
// extension sends, uploads the tailored resume into file inputs, and clicks Submit only when the
// side panel asks it to (after the person pressed Submit there). Nothing is sent anywhere by itself.
(() => {
  if (window.__ccpApply) return;
  window.__ccpApply = true;

  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const registry = [];
  const ats = (() => {
    const h = location.hostname;
    if (/greenhouse\.io$/.test(h)) return "greenhouse";
    if (/lever\.co$/.test(h)) return "lever";
    if (/workable\.com$/.test(h)) return "workable";
    if (/ashbyhq\.com$/.test(h)) return "ashby";
    if (/smartrecruiters\.com$/.test(h)) return "smartrecruiters";
    if (/myworkdayjobs\.com$/.test(h)) return "workday";
    if (/ultipro\.com$|ukg\.net$/.test(h)) return "ukg";
    if (/paylocity\.com$/.test(h)) return "paylocity";
    if (/icims\.com$/.test(h)) return "icims";
    if (/taleo\.net$/.test(h)) return "taleo";
    if (/bamboohr\.com$/.test(h)) return "bamboohr";
    if (/jobvite\.com$/.test(h)) return "jobvite";
    if (/successfactors\.com$/.test(h)) return "successfactors";
    return "generic";
  })();

  function labelOf(el) {
    const parts = [];
    if (el.id) for (const l of document.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`)) parts.push(clean(l.textContent));
    const wrap = el.closest("label");
    if (wrap) parts.push(clean(wrap.textContent));
    if (el.getAttribute("aria-label")) parts.push(clean(el.getAttribute("aria-label")));
    const by = el.getAttribute("aria-labelledby");
    if (by) for (const id of by.split(/\s+/)) { const n = document.getElementById(id); if (n) parts.push(clean(n.textContent)); }
    if (!parts.filter(Boolean).length) {
      // walk up to a field container and take its first text that is not the control itself
      let c = el.parentElement;
      for (let i = 0; i < 4 && c; i++, c = c.parentElement) {
        const cand = c.querySelector("label, legend, h3, h4, h5, .label, [class*='label'], [class*='question'], p, span");
        const t = cand && !cand.contains(el) ? clean(cand.textContent) : "";
        if (t && t.length < 200) { parts.push(t); break; }
      }
    }
    if (!parts.filter(Boolean).length && el.placeholder) parts.push(clean(el.placeholder));
    if (!parts.filter(Boolean).length && el.name) parts.push(clean(el.name.replace(/[_\-\[\]]+/g, " ")));
    const label = parts.filter(Boolean)[0] || "";
    return label.replace(/\s*\*\s*$/, "").slice(0, 200);
  }

  function groupLabel(el) {
    const fs = el.closest("fieldset");
    const legend = fs?.querySelector("legend");
    if (legend) return clean(legend.textContent);
    const grp = el.closest("[role='group'], [role='radiogroup']");
    if (grp) {
      const by = grp.getAttribute("aria-labelledby");
      const n = by && document.getElementById(by);
      if (n) return clean(n.textContent);
      if (grp.getAttribute("aria-label")) return clean(grp.getAttribute("aria-label"));
      const first = grp.querySelector("legend, label, p, span, div");
      if (first && !first.querySelector("input")) return clean(first.textContent);
    }
    let c = el.parentElement;
    for (let i = 0; i < 5 && c; i++, c = c.parentElement) {
      const radios = c.querySelectorAll(`input[type='radio'][name="${CSS.escape(el.name)}"]`);
      if (radios.length >= 2) {
        const texts = [...c.querySelectorAll("legend, label, p, span, div, h3, h4")].map((n) => clean(n.textContent)).filter((t) => t && t.length < 220 && !c.querySelector("input")?.labels?.[0]?.textContent.includes(t));
        if (texts[0]) return texts[0];
      }
    }
    return "";
  }

  function scan() {
    registry.length = 0;
    const questions = [];
    const seenRadio = new Set();
    const controls = [...document.querySelectorAll("input, select, textarea, [contenteditable='true'], [role='combobox']")].filter((el) => {
      if (!visible(el)) return false;
      if (el.tagName === "INPUT" && /^(hidden|submit|button|image|reset)$/i.test(el.type)) return false;
      if (el.closest("[aria-hidden='true']")) return false;
      return true;
    });
    for (const el of controls) {
      const type = el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : el.getAttribute("role") === "combobox" ? "combobox" : el.isContentEditable ? "textarea" : (el.type || "text").toLowerCase();
      if (type === "radio") {
        if (!el.name || seenRadio.has(el.name)) continue;
        seenRadio.add(el.name);
        const radios = [...document.querySelectorAll(`input[type='radio'][name="${CSS.escape(el.name)}"]`)];
        const options = radios.map((r) => labelOf(r) || r.value);
        const id = `ccp-${registry.length}`;
        registry.push({ el: radios, type: "radio" });
        questions.push({ id, type: "radio", label: groupLabel(el) || labelOf(el), options, required: radios.some((r) => r.required), value: options[radios.findIndex((r) => r.checked)] || "" });
        continue;
      }
      const id = `ccp-${registry.length}`;
      registry.push({ el, type });
      const q = { id, type, label: labelOf(el), required: !!(el.required || el.getAttribute("aria-required") === "true"), value: "" };
      if (type === "select") {
        q.options = [...el.options].map((o) => clean(o.textContent)).filter((t) => t && !/^(select|choose|please select|--)/i.test(t));
        q.value = clean(el.options[el.selectedIndex]?.textContent || "");
      } else if (type === "checkbox") {
        q.value = el.checked ? "yes" : "";
        q.options = ["Yes", "No"];
      } else if (type === "file") {
        q.accept = el.accept || "";
      } else {
        q.value = el.isContentEditable ? clean(el.textContent) : (el.value || "");
      }
      questions.push(q);
    }
    const submit = findSubmit();
    return { ats, url: location.href, title: document.title, questions, submitText: submit ? clean(submit.textContent || submit.value) : "", pageText: clean(document.body.innerText).slice(0, 3000) };
  }

  const setNative = (el, value) => {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  };

  function matchOption(options, answer) {
    const a = clean(String(answer)).toLowerCase();
    let i = options.findIndex((o) => clean(o).toLowerCase() === a);
    if (i < 0) i = options.findIndex((o) => clean(o).toLowerCase().startsWith(a) || a.startsWith(clean(o).toLowerCase()));
    if (i < 0) { const c = options.map((o, j) => [j, clean(o).toLowerCase()]).filter(([, o]) => o.includes(a) || a.includes(o)); if (c.length === 1) i = c[0][0]; }
    return i;
  }

  async function fill(answers, resume) {
    const report = [];
    for (const a of answers) {
      const entry = registry[+String(a.id).replace("ccp-", "")];
      if (!entry || a.answer == null || a.answer === "") continue;
      const { el, type } = entry;
      try {
        if (type === "radio") {
          const labels = el.map((r) => labelOf(r) || r.value);
          const i = typeof a.answer === "boolean" ? labels.findIndex((l) => (a.answer ? /^yes/i : /^no/i).test(l)) : matchOption(labels, a.answer);
          if (i >= 0) { el[i].click(); el[i].dispatchEvent(new Event("change", { bubbles: true })); report.push({ id: a.id, ok: true, value: labels[i] }); }
          else report.push({ id: a.id, ok: false, note: "no matching option" });
        } else if (type === "select") {
          const opts = [...el.options].map((o) => clean(o.textContent));
          const i = typeof a.answer === "boolean" ? opts.findIndex((l) => (a.answer ? /^yes/i : /^no/i).test(l)) : matchOption(opts, a.answer);
          if (i >= 0) { el.selectedIndex = i; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); report.push({ id: a.id, ok: true, value: opts[i] }); }
          else report.push({ id: a.id, ok: false, note: "no matching option" });
        } else if (type === "checkbox") {
          const want = typeof a.answer === "boolean" ? a.answer : /^(yes|true|1|agree|i agree)/i.test(String(a.answer));
          if (el.checked !== want) el.click();
          report.push({ id: a.id, ok: true, value: want ? "checked" : "unchecked" });
        } else if (type === "file") {
          if (!resume?.bytesB64) { report.push({ id: a.id, ok: false, note: "no resume file" }); continue; }
          const bin = atob(resume.bytesB64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const file = new File([bytes], resume.fileName || "resume.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
          const dt = new DataTransfer();
          dt.items.add(file);
          el.files = dt.files;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          report.push({ id: a.id, ok: true, value: file.name });
        } else if (type === "combobox") {
          el.focus();
          if (el.tagName === "INPUT") setNative(el, String(a.answer));
          else { el.textContent = String(a.answer); el.dispatchEvent(new Event("input", { bubbles: true })); }
          await new Promise((r) => setTimeout(r, 400));
          const opt = [...document.querySelectorAll("[role='option']")].find((o) => visible(o) && clean(o.textContent).toLowerCase().includes(clean(String(a.answer)).toLowerCase()));
          if (opt) { opt.click(); report.push({ id: a.id, ok: true, value: clean(opt.textContent) }); }
          else { el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); report.push({ id: a.id, ok: true, value: String(a.answer), note: "typed - please check the dropdown" }); }
        } else if (el.isContentEditable) {
          el.focus();
          el.textContent = String(a.answer);
          el.dispatchEvent(new Event("input", { bubbles: true }));
          report.push({ id: a.id, ok: true, value: String(a.answer) });
        } else {
          const v = typeof a.answer === "boolean" ? (a.answer ? "Yes" : "No") : String(a.answer);
          el.focus();
          setNative(el, v);
          report.push({ id: a.id, ok: true, value: v });
        }
      } catch (e) {
        report.push({ id: a.id, ok: false, note: e.message });
      }
    }
    return { report };
  }

  function findSubmit() {
    const buttons = [...document.querySelectorAll("button, input[type='submit'], a[role='button'], [role='button']")].filter(visible);
    const text = (b) => clean(b.textContent || b.value || b.getAttribute("aria-label"));
    return buttons.find((b) => /submit application|submit your application|send application|^submit$|^apply$|apply now|^apply for this job/i.test(text(b)) && !b.disabled)
      || buttons.find((b) => /submit/i.test(text(b)) && !b.disabled)
      || null;
  }

  function findNext() {
    const buttons = [...document.querySelectorAll("button, input[type='submit'], [role='button']")].filter(visible);
    const text = (b) => clean(b.textContent || b.value);
    return buttons.find((b) => /^(next|continue|save and continue|save & continue|proceed)\b/i.test(text(b)) && !b.disabled) || null;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "APPLY_SCAN") {
      try { sendResponse(scan()); } catch (e) { sendResponse({ error: e.message }); }
      return;
    }
    if (msg?.type === "APPLY_FILL") {
      fill(msg.answers || [], msg.resume).then(sendResponse, (e) => sendResponse({ error: e.message }));
      return true;
    }
    if (msg?.type === "APPLY_SUBMIT") {
      const b = findSubmit();
      if (!b) return sendResponse({ clicked: false, note: "No submit button found - click it on the page." });
      b.click();
      setTimeout(() => sendResponse({ clicked: true, text: clean(b.textContent || b.value), url: location.href, pageText: clean(document.body.innerText).slice(0, 600) }), 1500);
      return true;
    }
    if (msg?.type === "APPLY_NEXT") {
      const b = findNext();
      if (!b) return sendResponse({ clicked: false });
      b.click();
      setTimeout(() => sendResponse({ clicked: true, text: clean(b.textContent || b.value) }), 1200);
      return true;
    }
    if (msg?.type === "PAGE_TEXT") {
      sendResponse({ url: location.href, title: document.title, text: clean(document.body.innerText).slice(0, 20000) });
    }
  });
})();
