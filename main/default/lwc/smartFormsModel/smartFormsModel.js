/**
 * Pure helpers shared by the Smart Forms components: field/dependency rules,
 * safe text formatting, and the generators for the public form's HTML, CSS and JS.
 * No DOM access and no Salesforce imports, so everything here is unit-testable.
 */

const CONTROLLING_TYPES = ['PICKLIST', 'MULTIPICKLIST', 'BOOLEAN'];

export const MAX_CHOICES = 25;

export function isLookupType(type) {
    return String(type || '').toUpperCase() === 'REFERENCE';
}

/**
 * Normalises a lookup setting: { mode: 'fixed', record: { id, label, showToVisitors } } or
 * { mode: 'choices', choices: [{ key, id, label }] }. Anything else means "not configured".
 */
export function normalizeLookup(lookup) {
    if (!lookup || typeof lookup !== 'object') return null;
    if (lookup.mode === 'fixed') {
        const r = lookup.record || {};
        return { mode: 'fixed', record: { id: r.id || '', label: r.label || '', showToVisitors: !!r.showToVisitors } };
    }
    if (lookup.mode === 'choices') {
        const choices = (Array.isArray(lookup.choices) ? lookup.choices : [])
            .filter((c) => c && c.key && c.id)
            .map((c) => ({ key: c.key, id: c.id, label: c.label || '' }));
        return { mode: 'choices', choices };
    }
    return null;
}

/** True when the lookup is configured completely (a record chosen, or at least one choice). */
export function isLookupComplete(field) {
    const l = field && field.lookup;
    if (!l) return false;
    if (l.mode === 'fixed') return !!(l.record && l.record.id);
    return l.mode === 'choices' && l.choices.length > 0 && l.choices.length <= MAX_CHOICES;
}

/**
 * Whether visitors get anything for this field. Lookup fields are hidden until the admin configures
 * them: a fixed record is shown only when allowed, selected choices become a dropdown.
 */
export function isVisitorField(field) {
    if (!field) return false;
    if (!isLookupType(field.type)) return true;
    if (!isLookupComplete(field)) return false;
    return field.lookup.mode === 'choices' || !!field.lookup.record.showToVisitors;
}

/** One-line description of a lookup field's state for the builder canvas. */
export function lookupSummary(field) {
    if (!isLookupComplete(field)) return 'Hidden from visitors';
    const l = field.lookup;
    if (l.mode === 'choices') return `Visitors choose from ${l.choices.length} record${l.choices.length === 1 ? '' : 's'}`;
    return l.record.showToVisitors ? `Fixed record, shown to visitors: ${l.record.label}` : `Fixed record (hidden): ${l.record.label}`;
}

export function isControllingType(type) {
    return CONTROLLING_TYPES.includes(String(type || '').toUpperCase());
}

/** Normalised (upper-case) Salesforce field type, e.g. MULTIPICKLIST. */
export function typeLabel(type) {
    return String(type || 'STRING').toUpperCase();
}

export function normalizeError(error) {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    if (Array.isArray(error.body)) return error.body.map((e) => e.message).join(', ');
    if (error.body && error.body.message) return error.body.message;
    if (error.message) return error.message;
    return 'Unknown error';
}

/** JSON.parse that never throws: { value, error }. */
export function parseJson(text) {
    try {
        return { value: JSON.parse(text), error: null };
    } catch (error) {
        return { value: null, error };
    }
}

export function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => {
        switch (c) {
            case '&':
                return '&amp;';
            case '<':
                return '&lt;';
            case '>':
                return '&gt;';
            case '"':
                return '&quot;';
            default:
                return '&#39;';
        }
    });
}

export function joinOr(list) {
    const items = Array.isArray(list) ? list.filter((x) => x !== '' && x != null) : [];
    if (items.length <= 1) return items[0] || '';
    return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/** Splits **bold** and `mono` markers into render segments (no HTML is ever produced). */
export function parseRich(text) {
    const segments = [];
    const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    String(text || '')
        .split(pattern)
        .forEach((part, index) => {
            if (!part) return;
            const key = `s${index}`;
            if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
                segments.push({ key, text: part.slice(2, -2), isBold: true, isMono: false, isPlain: false });
            } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
                segments.push({ key, text: part.slice(1, -1), isBold: false, isMono: true, isPlain: false });
            } else {
                segments.push({ key, text: part, isBold: false, isMono: false, isPlain: true });
            }
        });
    return segments;
}

export function stripRich(text) {
    return String(text || '').replace(/\*\*|`/g, '');
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', day: '2-digit', year: 'numeric' });
const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
});

export function formatDate(value, withTime = false) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return (withTime ? DATE_TIME_FORMAT : DATE_FORMAT).format(d);
}

/** Parses the Field_Config__c JSON saved with a form. Never throws. */
export function parseFieldConfig(json) {
    const { value: parsed } = parseJson(json || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
        .filter((f) => f && f.apiName)
        .map((f) => ({
            apiName: f.apiName,
            label: f.label || f.apiName,
            type: typeLabel(f.type),
            required: !!f.required,
            placeholder: f.placeholder || '',
            picklistValues: Array.isArray(f.picklistValues) ? f.picklistValues : [],
            referenceTo: Array.isArray(f.referenceTo) ? f.referenceTo : [],
            lookup: normalizeLookup(f.lookup),
            dependency: f.dependency && f.dependency.controllingApi ? f.dependency : null
        }));
}

/** Answers a controlling field can offer: checkbox -> Checked/Unchecked, picklists -> their values. */
export function controllingAnswers(field) {
    if (!field) return [];
    if (String(field.type).toUpperCase() === 'BOOLEAN') {
        return [
            { value: 'true', label: 'Checked' },
            { value: 'false', label: 'Unchecked' }
        ];
    }
    return (field.picklistValues || []).map((p) => ({ value: p.value, label: p.label }));
}

export function answerLabel(field, value) {
    const hit = controllingAnswers(field).find((a) => a.value === value);
    return hit ? hit.label : value;
}

/**
 * Decides whether a dependent field is visible.
 * @param {object} field field with an optional `dependency`
 * @param {object} values current answers keyed by api name (string, string[] or boolean)
 */
export function isFieldShown(field, values) {
    const dep = field && field.dependency;
    if (!dep || !dep.controllingApi) return true;
    const wanted = Array.isArray(dep.controllingValues) ? dep.controllingValues : [];
    const raw = values ? values[dep.controllingApi] : undefined;
    let current;
    if (typeof raw === 'boolean') current = [raw ? 'true' : 'false'];
    else if (Array.isArray(raw)) current = raw;
    else current = [raw == null ? '' : String(raw)];
    return wanted.some((w) => current.includes(w));
}

export function buildFieldConfigJson(fields) {
    return JSON.stringify(
        (fields || []).map((f) => ({
            apiName: f.apiName,
            label: f.label,
            type: f.type,
            required: f.required,
            placeholder: f.placeholder,
            picklistValues: f.picklistValues,
            referenceTo: f.referenceTo || [],
            lookup: normalizeLookup(f.lookup),
            dependency: f.dependency
        }))
    );
}

export function buildDependencyJson(fields) {
    const deps = {};
    (fields || []).forEach((f) => {
        if (f && f.dependency && f.dependency.controllingApi) {
            deps[f.apiName] = {
                controllingField: f.dependency.controllingApi,
                controllingValues: f.dependency.controllingValues
            };
        }
    });
    return JSON.stringify(deps);
}

/** Builds the public form markup. Every interpolated value is HTML-escaped. */
export function buildFormHtml(formName, fields) {
    const visible = (fields || []).filter(isVisitorField);
    if (visible.length === 0) return '';
    const rows = visible.map((f) => {
        const api = escapeHtml(f.apiName);
        const id = `field-${api}`;
        const label = escapeHtml(f.label);
        const requiredAttr = f.required ? 'required' : '';
        const placeholder = escapeHtml(f.placeholder || '');
        const type = (f.type || 'string').toLowerCase();
        const labelHtml = `<label for="${id}">${label}${f.required ? '<span class="req">*</span>' : ''}</label>`;
        let wrapper = `<div class="field" data-api-name="${api}">`;
        if (f.dependency && f.dependency.controllingApi) {
            const vals = Array.isArray(f.dependency.controllingValues) ? f.dependency.controllingValues : [];
            wrapper =
                `<div class="field dependent-field" data-api-name="${api}"` +
                ` data-controlling-field="${escapeHtml(f.dependency.controllingApi)}"` +
                ` data-controlling-values="${escapeHtml(vals.join(','))}">`;
        }
        if (isLookupType(f.type)) {
            // Lookups never expose record Ids: a fixed record is shown as plain text, choices carry an opaque key.
            if (f.lookup.mode === 'fixed') {
                return `${wrapper}<label>${label}</label><div class="readonly-value">${escapeHtml(f.lookup.record.label)}</div></div>`;
            }
            const choiceOptions = f.lookup.choices
                .map((c) => `<option value="${escapeHtml(c.key)}">${escapeHtml(c.label)}</option>`)
                .join('');
            return `${wrapper}${labelHtml}<select id="${id}" class="control" data-api-name="${api}" ${requiredAttr}><option value="">--Select--</option>${choiceOptions}</select></div>`;
        }
        const options = (Array.isArray(f.picklistValues) ? f.picklistValues : [])
            .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
            .join('');
        if (type === 'checkbox' || type === 'boolean') {
            return `${wrapper}<div class="checkbox-line"><input type="checkbox" id="${id}" data-api-name="${api}" ${requiredAttr} /><label for="${id}">${label}</label></div></div>`;
        }
        if (type === 'picklist') {
            return `${wrapper}${labelHtml}<select id="${id}" class="control" data-api-name="${api}" ${requiredAttr}><option value="">--Select--</option>${options}</select></div>`;
        }
        if (type === 'multipicklist') {
            return `${wrapper}${labelHtml}<select id="${id}" class="control" data-api-name="${api}" multiple ${requiredAttr}>${options}</select></div>`;
        }
        if (type === 'textarea') {
            return `${wrapper}${labelHtml}<textarea id="${id}" class="control" data-api-name="${api}" ${requiredAttr} placeholder="${placeholder}"></textarea></div>`;
        }
        if (type === 'date') {
            return `${wrapper}${labelHtml}<input type="date" id="${id}" class="control" data-api-name="${api}" ${requiredAttr} placeholder="${placeholder}" /></div>`;
        }
        if (type === 'datetime') {
            return `${wrapper}${labelHtml}<input type="datetime-local" id="${id}" class="control" data-api-name="${api}" ${requiredAttr} placeholder="${placeholder}" /></div>`;
        }
        return `${wrapper}${labelHtml}<input type="text" id="${id}" class="control" data-api-name="${api}" ${requiredAttr} placeholder="${placeholder}" /></div>`;
    });
    // No inline handlers: the server-side sanitizer strips them; submit is bound by the generated JS.
    // Honeypot: invisible to people, filled in by simple bots. The generated script drops such submissions.
    const honeypot = '<div style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden" aria-hidden="true"><label>Leave this field empty<input type="text" name="hp_website" tabindex="-1" autocomplete="off" /></label></div>';
    return `<div class="form-card"><h3>${escapeHtml(formName)}</h3><form class="form-body">${rows.join('')}${honeypot}<button class="btn-primary" type="submit">Submit</button></form></div>`.trim();
}


export function buildFormCss() {
    return `/* Deep Blue Background */ body { margin: 0; padding: 0; min-height: 100vh; background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%); position: relative; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; display: flex; align-items: center; justify-content: center; overflow: hidden; } body::before { content: ""; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle at 20% 30%, rgba(59, 130, 246, 0.08) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(99, 102, 241, 0.06) 0%, transparent 50%); pointer-events: none; animation: subtleFloat 25s ease-in-out infinite; } @keyframes subtleFloat { 0%, 100% { transform: translate(0, 0) rotate(0deg); } 50% { transform: translate(1.5%, 1.5%) rotate(0.5deg); } } .form-card { --bg: rgba(255, 255, 255, 0.04); --text: #f8fafc; --muted: #cbd5e1; --border: rgba(148, 163, 184, 0.12); --primary: #3b82f6; --primaryHover: #2563eb; --danger: #f87171; --inputBg: rgba(15, 23, 42, 0.4); --inputBorder: rgba(148, 163, 184, 0.15); --focusBorder: rgba(59, 130, 246, 0.4); position: relative; box-sizing: border-box; max-width: 420px; width: 100%; margin: 32px; padding: 48px 40px; background: var(--bg); border: 1px solid var(--border); border-radius: 20px; backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05); font-family: inherit; color: var(--text); } .form-card::before { content: ""; position: absolute; top: 0; left: 0; right: 0; bottom: 0; border-radius: 20px; padding: 1px; background: linear-gradient(135deg, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0) 50%); -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none; } .form-card * { box-sizing: border-box; } .form-card h3 { margin: 0 0 36px; font-size: 1.625rem; font-weight: 600; color: #ffffff; text-align: center; letter-spacing: -0.5px; line-height: 1.2; } .form-body { margin: 0; } .field { margin-bottom: 24px; } .form-card label { display: block; margin-bottom: 8px; font-size: 0.875rem; font-weight: 500; color: var(--muted); letter-spacing: 0.01em; } .req { color: var(--danger); margin-left: 3px; } .control, .form-card input, .form-card select, .form-card textarea { width: 100%; padding: 13px 16px; border: 1px solid var(--inputBorder); border-radius: 10px; background: var(--inputBg); color: var(--text); font-size: 0.9375rem; line-height: 1.5; transition: all 0.2s ease; box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.15); } .form-card input::placeholder, .form-card textarea::placeholder { color: rgba(203, 213, 225, 0.5); font-weight: 400; } .form-card input:hover, .form-card select:hover, .form-card textarea:hover { background: rgba(15, 23, 42, 0.5); border-color: rgba(148, 163, 184, 0.2); } .form-card input:focus, .form-card select:focus, .form-card textarea:focus { outline: none; border-color: var(--focusBorder); background: rgba(15, 23, 42, 0.6); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1), inset 0 1px 3px rgba(0, 0, 0, 0.15); } .form-card textarea { min-height: 110px; resize: vertical; } .form-card button { margin-top: 28px; width: 100%; padding: 14px 24px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: #ffffff; border: none; border-radius: 10px; font-weight: 600; font-size: 0.9375rem; cursor: pointer; transition: all 0.2s ease; letter-spacing: 0.02em; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2), 0 1px 3px rgba(0, 0, 0, 0.2); } .form-card button:hover { background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); transform: translateY(-1px); box-shadow: 0 6px 16px rgba(59, 130, 246, 0.3), 0 2px 4px rgba(0, 0, 0, 0.2); } .form-card button:active { transform: translateY(0); box-shadow: 0 2px 8px rgba(59, 130, 246, 0.2), 0 1px 2px rgba(0, 0, 0, 0.2); } .checkbox-line { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; color: var(--muted); font-size: 0.875rem; } .checkbox-line input { width: auto; min-width: 16px; min-height: 16px; margin-right: 8px; accent-color: var(--primary); cursor: pointer; background-color: transparent; } .checkbox-line label { margin: 0; font-weight: 400; color: var(--muted); cursor: pointer; display: inline-flex; align-items: center; } @media (max-width: 520px) { body { padding: 16px; } .form-card { padding: 36px 28px; margin: 0; max-width: 100%; } .form-card h3 { font-size: 1.5rem; margin-bottom: 32px; } }`.trim();
}

export function buildFormJs(fields) {
    const hasDependencies = (fields || []).some(
        (f) =>
            f &&
            f.dependency &&
            f.dependency.controllingApi &&
            (f.dependency.controllingValues || []).length
    );

    const dependencyJS = hasDependencies
        ? [
            "(function(){",
            " function updateFieldVisibility(){",
            "  try{",
            "   var nodes=document.querySelectorAll('.field.dependent-field');",
            "   for(var i=0;i<nodes.length;i++){",
            "    var depField=nodes[i];",
            "    var controllingApi=depField.dataset.controllingField;",
            "    var raw=(depField.dataset.controllingValues||'');",
            "    var valueList=raw.split(',');",
            "    var cleaned=[];",
            "    for(var j=0;j<valueList.length;j++){",
            "     var v=(valueList[j]||'').trim();",
            "     if(v) cleaned.push(v);",
            "    }",
            "    if(!controllingApi||cleaned.length===0) continue;",
            "    var controllingEl=document.querySelector('input[data-api-name=\"'+controllingApi+'\"],select[data-api-name=\"'+controllingApi+'\"],textarea[data-api-name=\"'+controllingApi+'\"]');",
            "    if(!controllingEl) continue;",
            "    var currentValues=[];",
            "    if(controllingEl.tagName==='SELECT'){",
            "     if(controllingEl.multiple){",
            "      var opts=controllingEl.selectedOptions||[];",
            "      for(var k=0;k<opts.length;k++){ currentValues.push((opts[k].value||'').trim()); }",
            "     } else {",
            "      currentValues=[((controllingEl.value||'')+'').trim()];",
            "     }",
            "    } else if(controllingEl.tagName==='INPUT'&&controllingEl.type==='checkbox'){",
            "     currentValues=[controllingEl.checked?'true':'false'];",
            "    } else {",
            "     currentValues=[((controllingEl.value||'')+'').trim()];",
            "    }",
            "    var shouldShow=false;",
            "    for(var m=0;m<cleaned.length;m++){",
            "     if(currentValues.indexOf(cleaned[m])>-1){ shouldShow=true; break; }",
            "    }",
            "    depField.style.display=shouldShow?'block':'none';",
            "    var inputs=depField.querySelectorAll('input,select,textarea');",
            "    for(var n=0;n<inputs.length;n++){",
            "     var el=inputs[n];",
            "     if(shouldShow){",
            "      el.removeAttribute('disabled');",
            "     } else {",
            "      el.setAttribute('disabled','disabled');",
            "      if(el.type==='checkbox') el.checked=false;",
            "      else if('value' in el) el.value='';",
            "     }",
            "    }",
            "   }",
            "  }catch(e){}",
            " }",
            " window.updateFieldVisibility=updateFieldVisibility;",
            " // Run immediately \u2014 DOMContentLoaded already fired",
            " (function(){",
            "  updateFieldVisibility();",
            "  document.addEventListener('change',function(){ updateFieldVisibility(); });",
            " })();",
            "})();"
        ].join("\n")
        : "";

    const mainJS = [
        "(function(){",
        " if(window.__vfPublicFormInit) return;",
        " window.__vfPublicFormInit=true;",
        "",
        " window.handleSubmit=function(evt){",
        "  try{",
        "   if(evt&&typeof evt.preventDefault==='function') evt.preventDefault();",
        "",
        "   var formCard=document.querySelector('.form-card');",
        "   if(!formCard){ alert('Form container not found'); return; }",
        "",
        "   var hp=formCard.querySelector('input[name=\"hp_website\"]');",
        "   if(hp&&hp.value){ alert('Thank you! Submission received.'); return; }",
        "",
        "   var elements=formCard.querySelectorAll('input[data-api-name],select[data-api-name],textarea[data-api-name]');",
        "   var payload={};",
        "   var isValid=true;",
        "",
        "   for(var i=0;i<elements.length;i++){",
        "    var el=elements[i];",
        "    var apiName=el.getAttribute('data-api-name');",
        "    if(!apiName) continue;",
        "    try{ el.style.borderColor='#d1d5db'; }catch(e){}",
        "    if(el.disabled) continue;",
        "",
        "    var val='';",
        "    if(el.tagName==='SELECT'&&el.multiple){",
        "     var opts=el.selectedOptions||[];",
        "     var arr=[];",
        "     for(var j=0;j<opts.length;j++){",
        "      var v=(opts[j].value||'').trim();",
        "      if(v) arr.push(v);",
        "     }",
        "     val=arr.join(';');",
        "    } else if(el.type==='checkbox'){",
        "     val=!!el.checked;",
        "    } else {",
        "     val=((el.value||'')+'').trim();",
        "    }",
        "",
        "    if(el.hasAttribute('required')){",
        "     if(el.type==='checkbox'){",
        "      if(!val){ isValid=false; try{ el.style.borderColor='#ef4444'; }catch(e){} }",
        "     } else {",
        "      if(!val){ isValid=false; try{ el.style.borderColor='#ef4444'; }catch(e){} }",
        "     }",
        "    }",
        "",
        "    payload[apiName]=val;",
        "   }",
        "",
        "   if(!isValid){ alert('Please fill all required fields'); return; }",
        "   var keys=Object.keys(payload);",
        "   if(!keys||keys.length===0){ alert('No data to submit'); return; }",
        "",
        "   if(typeof Visualforce==='undefined'||!Visualforce.remoting||!Visualforce.remoting.Manager||typeof Visualforce.remoting.Manager.invokeAction!=='function'){",
        "    alert('Submission failed: Visualforce remoting is not available');",
        "    return;",
        "   }",
        "",
        "   var formId=new URLSearchParams(window.location.search).get('id');",
        "",
        "   var actionName = (typeof SAVE_SUBMISSION_ACTION !== 'undefined' && SAVE_SUBMISSION_ACTION) ? SAVE_SUBMISSION_ACTION : 'FormController.saveSubmission';",
        "",
        "   Visualforce.remoting.Manager.invokeAction(",
        "    actionName,",
        "    JSON.stringify(payload),",
        "    formId,",
        "    function(result,event){",
        "     try{ console.log('remoting event:', event, 'result:', result); }catch(e){}",
        "     if(event&&event.status){",
        "      alert(result||'Thank you! Submission received.');",
        "      for(var i2=0;i2<elements.length;i2++){",
        "       var e2=elements[i2];",
        "       if(e2.disabled) continue;",
        "       if(e2.type==='checkbox') e2.checked=false;",
        "       else if(e2.tagName==='SELECT'&&e2.multiple){",
        "        var ops=e2.options||[];",
        "        for(var k2=0;k2<ops.length;k2++){ ops[k2].selected=false; }",
        "       } else if('value' in e2) e2.value='';",
        "       try{ e2.style.borderColor='#d1d5db'; }catch(e){}",
        "      }",
        "      if(typeof window.updateFieldVisibility==='function'){ try{ window.updateFieldVisibility(); }catch(e){} }",
        "     } else {",
        "      alert('Submission failed: '+((event&&event.message)||'Unknown error'));",
        "     }",
        "    },",
        "    { escape: true }",
        "   );",
        "  }catch(err){",
        "   alert('Submission failed: '+(err&&err.message?err.message:err));",
        "  }",
        " };",
        "",
        " // Bind submit directly \u2014 DOMContentLoaded has already fired",
        " // when this JS executes via new Function() in PublicForm.page.",
        " (function(){",
        "  try{",
        "   var f=document.querySelector('.form-body');",
        "   if(!f) return;",
        "   f.addEventListener('submit', function(e){",
        "    e.preventDefault();",
        "    if(typeof window.handleSubmit==='function'){ window.handleSubmit(e); }",
        "   });",
        "  }catch(e){}",
        " })();",
        "",
        "})();"
    ].join("\n");

    return dependencyJS ? (mainJS + "\n\n" + dependencyJS) : mainJS;
}
