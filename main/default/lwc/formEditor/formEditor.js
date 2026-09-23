import { LightningElement, track, wire } from 'lwc';
import { publish, subscribe, unsubscribe, MessageContext } from 'lightning/messageService';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { CurrentPageReference } from 'lightning/navigation';

import FORM_PREVIEW_CHANNEL from '@salesforce/messageChannel/formPreviewChannel__c';

import fetchObjectOptions from '@salesforce/apex/FormEditorController.fetchObjectOptions';
import fetchFieldsForObject from '@salesforce/apex/FormEditorController.fetchFieldsForObject';
import saveFormTemplate from '@salesforce/apex/FormAuraController.saveFormTemplate';
import getFormData from '@salesforce/apex/FormEditorController.getFormData';

export default class FormEditor extends LightningElement {
    @track selectedObject = null;
    @track selectedFields = [];
    @track availableFields = [];
    @track formTemplateName = '';
    @track selectedFormId = null;
    @track formVersion = null;
    @track objectOptions = [];
    @track isLoading = false;
    @track searchTerm = '';

    subscription = null;

    _initializedFromState = false;
    _lastStateObj = null;
    _lastStateFormName = '';
    _lastStateFormId = null;

    @wire(MessageContext) messageContext;

    @wire(fetchObjectOptions)
    wiredObjects({ error, data }) {
        if (data) {
            this.objectOptions = data;

            if (!this.selectedObject && !this._initializedFromState && data.length === 1) {
                this.selectedObject = data[0].value;
                this.bootstrapObject(this.selectedObject);
            }
        } else if (error) {
            this.showToast('Error', 'Failed to load objects: ' + this.normalizeApexError(error), 'error');
        }
    }

    @wire(CurrentPageReference)
    wiredPageRef(pageRef) {
        const state = pageRef?.state || {};
        const objFromState = state.c__objectApiName || state.c__objectName || null;
        const raw = state.c__formName;
        const decoded = raw != null ? decodeURIComponent(String(raw).replace(/\+/g, " ")) : "";
        const formNameFromState = String(decoded || "").trim();
        const formIdFromState = state.c__formId || null;

        if (!objFromState && !formIdFromState && !formNameFromState) return;

        if (formNameFromState && formNameFromState !== this._lastStateFormName) {
            this._lastStateFormName = formNameFromState;
            this.formTemplateName = formNameFromState;
            this.publishPreviewUpdate();
        }

        if (formIdFromState && formIdFromState !== this._lastStateFormId) {
            this._lastStateFormId = formIdFromState;
            this.selectedFormId = formIdFromState;
            this.loadFormTemplate(formIdFromState);
            return;
        }

        if (objFromState && objFromState !== this._lastStateObj) {
            this._lastStateObj = objFromState;
            this.selectedObject = objFromState;

            // ✅ FIX: Reset all stale state before bootstrapping a fresh form
            this.selectedFields = [];
            this.selectedFormId = null;
            this.formVersion = null;
            this.searchTerm = '';

            this.bootstrapObject(objFromState);
        }
    }

    connectedCallback() {
        this.subscription = subscribe(
            this.messageContext,
            FORM_PREVIEW_CHANNEL,
            (message) => this.handleMessage(message)
        );
    }

    disconnectedCallback() {
        if (this.subscription) {
            unsubscribe(this.subscription);
            this.subscription = null;
        }
    }

    get filteredFields() {
        const list = Array.isArray(this.availableFields) ? this.availableFields : [];
        const term = (this.searchTerm || '').trim().toLowerCase();
        if (!term) return list;
        return list.filter(f => {
            const name = (f?.name || '').toLowerCase();
            const label = (f?.label || '').toLowerCase();
            return name.includes(term) || label.includes(term);
        });
    }

    get showEmptyState() {
        if (this.isLoading) return false;
        if (!this.selectedObject) return true;
        return this.filteredFields.length === 0;
    }

    get emptyStateMessage() {
        if (!this.selectedObject) return 'Select an object to load fields';
        if ((this.searchTerm || '').trim()) return 'No fields match your search';
        return 'No fields available';
    }

    handleFieldSearch(event) {
        this.searchTerm = event.target.value;
    }

    handleMessage(message) {
        if (!message || message.source === 'editor') return;

        if (message.action === 'loadForm') {
            this.loadFormTemplate(message.formId);
            return;
        }

        if (message.action === 'update' || message.action === 'reorder') {
            const incoming = Array.isArray(message.fields) ? message.fields : [];
            this.selectedFields = incoming.map(f => ({ ...f, placeholder: f.placeholder || '' }));
            this.formTemplateName = message.formName || this.formTemplateName || '';
            this.syncAvailableSelections();
            return;
        }

        if (message.action === 'deselectField' && message.apiName) {
            this.selectedFields = this.selectedFields.filter(f => f.apiName !== message.apiName);
            this.syncAvailableSelections();
            return;
        }
    }

    handleObjectChange(event) {
        this.selectedObject = event.detail.value;
        this.searchTerm = '';
        if (this.selectedObject) {
            this.bootstrapObject(this.selectedObject);
        } else {
            this.availableFields = [];
            this.selectedFields = [];
            this.publishPreviewUpdate();
        }
    }

    bootstrapObject(objectApiName) {
        this.loadFieldsForObject(objectApiName)
            .then(() => {
                if (!this.selectedFields || this.selectedFields.length === 0) {
                    this.autoSelectRequiredFields();
                }
                this.publishPreviewUpdate();
            })
            .catch(() => {});
    }

    loadFieldsForObject(objectName) {
        this.isLoading = true;
        return fetchFieldsForObject({ objectName })
            .then(data => {
                const rows = Array.isArray(data) ? data : [];
                const selectedApiNames = new Set((this.selectedFields || []).map(sf => sf.apiName));
                this.availableFields = rows.map(field => ({
                    ...field,
                    required: !!field.required,
                    placeholder: field.placeholder || '',
                    dependency: field.dependency || null,
                    selected: selectedApiNames.has(field.name)
                }));
                this.isLoading = false;
            })
            .catch(error => {
                this.isLoading = false;
                this.showToast('Error', 'Failed to load fields: ' + this.normalizeApexError(error), 'error');
                throw error;
            });
    }

    autoSelectRequiredFields() {
        const requiredFields = (this.availableFields || []).filter(f => f.required);
        const existing = new Set((this.selectedFields || []).map(f => f.apiName));
        const toAdd = requiredFields
            .filter(f => !existing.has(f.name))
            .map(f => ({
                apiName: f.name,
                label: f.label,
                type: f.type,
                required: true,
                picklistValues: f.picklistValues || [],
                placeholder: '',
                dependency: null
            }));
        if (toAdd.length > 0) {
            this.selectedFields = [...this.selectedFields, ...toAdd];
        }
        this.syncAvailableSelections();
    }

    syncAvailableSelections() {
        const selected = new Set((this.selectedFields || []).map(f => f.apiName));
        this.availableFields = (this.availableFields || []).map(f => ({
            ...f,
            selected: selected.has(f.name)
        }));
    }

    handleFieldSelection(event) {
        const apiName = event.currentTarget?.dataset?.apiName;
        const checked = !!event.target.checked;
        if (!apiName) return;
        const field = (this.availableFields || []).find(f => f.name === apiName);
        if (!field) return;
        if (checked) {
            if (!this.selectedFields.some(f => f.apiName === apiName)) {
                this.selectedFields = [
                    ...this.selectedFields,
                    {
                        apiName: field.name,
                        label: field.label,
                        type: field.type,
                        required: field.required,
                        picklistValues: field.picklistValues || [],
                        placeholder: '',
                        dependency: null
                    }
                ];
            }
        } else {
            this.selectedFields = (this.selectedFields || []).filter(f => f.apiName !== apiName);
        }
        this.syncAvailableSelections();
        this.publishPreviewUpdate();
    }

    selectAllFields() {
        const all = (this.availableFields || []).map(f => ({
            apiName: f.name,
            label: f.label,
            type: f.type,
            required: !!f.required,
            picklistValues: f.picklistValues || [],
            placeholder: '',
            dependency: null
        }));
        this.selectedFields = all;
        this.syncAvailableSelections();
        this.publishPreviewUpdate();
    }

    deselectAllFields() {
        this.selectedFields = [];
        this.syncAvailableSelections();
        this.publishPreviewUpdate();
    }

    publishPreviewUpdate() {
        publish(this.messageContext, FORM_PREVIEW_CHANNEL, {
            action: 'update',
            source: 'editor',
            formName: this.formTemplateName,
            fields: this.selectedFields
        });
    }

    async saveForm() {
        try {
            const rawName = this.formTemplateName ?? this._lastStateFormName ?? "";
            const nameForSave = String(rawName).replace(/\+/g, " ").trim();
            if (!nameForSave) {
                this.showToast("Error", "Form name is required.", "error");
                return;
            }
            if (!this.selectedObject) {
                this.showToast("Error", "Select an object first.", "error");
                return;
            }
            if (!this.selectedFields || this.selectedFields.length === 0) {
                this.showToast("Error", "Select at least one field.", "error");
                return;
            }

            const generatedHtml = this.getFormHTML() || "";
            const generatedCss = this.getFormCSS() || "";
            const generatedJs = this.generateFormJS(this.selectedFields) || "";
            const dependencyMap = this.buildDependencyMap() || {};
            const fieldDependenciesJson = JSON.stringify(dependencyMap);
            const fieldConfig = this.selectedFields.map(f => ({
                apiName: f.apiName,
                label: f.label,
                type: f.type,
                required: f.required,
                placeholder: f.placeholder,
                picklistValues: f.picklistValues,
                dependency: f.dependency
            }));
            const fieldConfigJson = JSON.stringify(fieldConfig);

            const payload = {
                name: nameForSave,
                objectApiName: this.selectedObject || null,
                formId: this.selectedFormId || null,
                html: generatedHtml,
                css: generatedCss,
                js: generatedJs,
                fieldDependenciesJson: fieldDependenciesJson,
                fieldConfigJson: fieldConfigJson
            };

            const plainPayload = JSON.parse(JSON.stringify(payload));
            this.isSaving = true;

            const result = await saveFormTemplate({ reqJson: JSON.stringify(plainPayload) });

            if (result) {
                this.selectedFormId = result;
                this.showToast("Success", "Form saved successfully.", "success");
            }
            return result;
        } catch (e) {
            this.showToast("Error", e?.body?.message || e?.message || "Failed to save form.", "error");
        } finally {
            this.isSaving = false;
        }
    }

    loadFormTemplate(formId) {
        if (!formId) return;
        this.isLoading = true;
        getFormData({ formId })
            .then(data => {
                this.isLoading = false;
                if (!data) return;
                this.formTemplateName = data.name || '';
                this.selectedObject = data.objectApiName || null;
                const parsed = JSON.parse(data.fieldConfig || '[]');
                this.selectedFields = Array.isArray(parsed) ? parsed : [];
                this.formVersion = data.version;
                this.selectedFormId = data.id;
                if (this.selectedObject) {
                    this.loadFieldsForObject(this.selectedObject)
                        .then(() => {
                            this.autoSelectRequiredFields();
                            this.publishPreviewUpdate();
                        });
                } else {
                    this.publishPreviewUpdate();
                }
            })
            .catch(error => {
                this.isLoading = false;
                this.showToast('Error', 'Failed to load form: ' + this.normalizeApexError(error), 'error');
            });
    }

    buildDependencyMap() {
        const deps = {};
        (this.selectedFields || []).forEach(f => {
            if (f?.dependency?.controllingApi) {
                deps[f.apiName] = {
                    controllingField: f.dependency.controllingApi,
                    controllingValues: f.dependency.controllingValues
                };
            }
        });
        return deps;
    }

    getFormHTML() {
        if (!this.selectedFields || this.selectedFields.length === 0) return '';
        const rows = [];
        (this.selectedFields || []).forEach(f => {
            const id = `field-${f.apiName}`;
            const requiredAttr = f.required ? 'required' : '';
            const placeholderText = f.placeholder || '';
            const fieldType = (f.type || 'string').toLowerCase();
            const labelHtml = `<label for="${id}">${f.label}${f.required ? '<span class="req">*</span>' : ''}</label>`;
            let fieldWrapper = `<div class="field" data-api-name="${f.apiName}">`;
            if (f.dependency && f.dependency.controllingApi) {
                const vals = Array.isArray(f.dependency.controllingValues) ? f.dependency.controllingValues : [];
                fieldWrapper = `<div class="field dependent-field" data-api-name="${f.apiName}" data-controlling-field="${f.dependency.controllingApi}" data-controlling-values="${vals.join(',')}">`;
            }
            if (fieldType === 'checkbox' || fieldType === 'boolean') {
                rows.push(`${fieldWrapper}<div class="checkbox-line"><input type="checkbox" id="${id}" data-api-name="${f.apiName}" ${requiredAttr} /><label for="${id}">${f.label}</label></div></div>`);
                return;
            }
            if (fieldType === 'picklist') {
                const opts = Array.isArray(f.picklistValues) ? f.picklistValues : [];
                const options = opts.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('');
                rows.push(`${fieldWrapper}${labelHtml}<select id="${id}" class="control" data-api-name="${f.apiName}" ${requiredAttr}><option value="">--Select--</option>${options}</select></div>`);
                return;
            }
            if (fieldType === 'multipicklist') {
                const opts = Array.isArray(f.picklistValues) ? f.picklistValues : [];
                const options = opts.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('');
                rows.push(`${fieldWrapper}${labelHtml}<select id="${id}" class="control" data-api-name="${f.apiName}" multiple ${requiredAttr}>${options}</select></div>`);
                return;
            }
            if (fieldType === 'textarea') {
                rows.push(`${fieldWrapper}${labelHtml}<textarea id="${id}" class="control" data-api-name="${f.apiName}" ${requiredAttr} placeholder="${placeholderText}"></textarea></div>`);
                return;
            }
            if (fieldType === 'date') {
                rows.push(`${fieldWrapper}${labelHtml}<input type="date" id="${id}" class="control" data-api-name="${f.apiName}" ${requiredAttr} placeholder="${placeholderText}" /></div>`);
                return;
            }
            if (fieldType === 'datetime') {
                rows.push(`${fieldWrapper}${labelHtml}<input type="datetime-local" id="${id}" class="control" data-api-name="${f.apiName}" ${requiredAttr} placeholder="${placeholderText}" /></div>`);
                return;
            }
            rows.push(`${fieldWrapper}${labelHtml}<input type="text" id="${id}" class="control" data-api-name="${f.apiName}" ${requiredAttr} placeholder="${placeholderText}" /></div>`);
        });

        // ✅ NO inline onsubmit (sanitizer strips it)
        return `<div class="form-card"><h3>${this.formTemplateName}</h3><form class="form-body">${rows.join('')}<button class="btn-primary" type="submit">Submit</button></form></div>`.trim();
    }

    getFormCSS() {
        return `/* Deep Blue Background */ body { margin: 0; padding: 0; min-height: 100vh; background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%); position: relative; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; display: flex; align-items: center; justify-content: center; overflow: hidden; } body::before { content: ""; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: radial-gradient(circle at 20% 30%, rgba(59, 130, 246, 0.08) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(99, 102, 241, 0.06) 0%, transparent 50%); pointer-events: none; animation: subtleFloat 25s ease-in-out infinite; } @keyframes subtleFloat { 0%, 100% { transform: translate(0, 0) rotate(0deg); } 50% { transform: translate(1.5%, 1.5%) rotate(0.5deg); } } .form-card { --bg: rgba(255, 255, 255, 0.04); --text: #f8fafc; --muted: #cbd5e1; --border: rgba(148, 163, 184, 0.12); --primary: #3b82f6; --primaryHover: #2563eb; --danger: #f87171; --inputBg: rgba(15, 23, 42, 0.4); --inputBorder: rgba(148, 163, 184, 0.15); --focusBorder: rgba(59, 130, 246, 0.4); position: relative; box-sizing: border-box; max-width: 420px; width: 100%; margin: 32px; padding: 48px 40px; background: var(--bg); border: 1px solid var(--border); border-radius: 20px; backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.05); font-family: inherit; color: var(--text); } .form-card::before { content: ""; position: absolute; top: 0; left: 0; right: 0; bottom: 0; border-radius: 20px; padding: 1px; background: linear-gradient(135deg, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0) 50%); -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none; } .form-card * { box-sizing: border-box; } .form-card h3 { margin: 0 0 36px; font-size: 1.625rem; font-weight: 600; color: #ffffff; text-align: center; letter-spacing: -0.5px; line-height: 1.2; } .form-body { margin: 0; } .field { margin-bottom: 24px; } .form-card label { display: block; margin-bottom: 8px; font-size: 0.875rem; font-weight: 500; color: var(--muted); letter-spacing: 0.01em; } .req { color: var(--danger); margin-left: 3px; } .control, .form-card input, .form-card select, .form-card textarea { width: 100%; padding: 13px 16px; border: 1px solid var(--inputBorder); border-radius: 10px; background: var(--inputBg); color: var(--text); font-size: 0.9375rem; line-height: 1.5; transition: all 0.2s ease; box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.15); } .form-card input::placeholder, .form-card textarea::placeholder { color: rgba(203, 213, 225, 0.5); font-weight: 400; } .form-card input:hover, .form-card select:hover, .form-card textarea:hover { background: rgba(15, 23, 42, 0.5); border-color: rgba(148, 163, 184, 0.2); } .form-card input:focus, .form-card select:focus, .form-card textarea:focus { outline: none; border-color: var(--focusBorder); background: rgba(15, 23, 42, 0.6); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1), inset 0 1px 3px rgba(0, 0, 0, 0.15); } .form-card textarea { min-height: 110px; resize: vertical; } .form-card button { margin-top: 28px; width: 100%; padding: 14px 24px; background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%); color: #ffffff; border: none; border-radius: 10px; font-weight: 600; font-size: 0.9375rem; cursor: pointer; transition: all 0.2s ease; letter-spacing: 0.02em; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2), 0 1px 3px rgba(0, 0, 0, 0.2); } .form-card button:hover { background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); transform: translateY(-1px); box-shadow: 0 6px 16px rgba(59, 130, 246, 0.3), 0 2px 4px rgba(0, 0, 0, 0.2); } .form-card button:active { transform: translateY(0); box-shadow: 0 2px 8px rgba(59, 130, 246, 0.2), 0 1px 2px rgba(0, 0, 0, 0.2); } .checkbox-line { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; color: var(--muted); font-size: 0.875rem; } .checkbox-line input { width: auto; min-width: 16px; min-height: 16px; margin-right: 8px; accent-color: var(--primary); cursor: pointer; background-color: transparent; } .checkbox-line label { margin: 0; font-weight: 400; color: var(--muted); cursor: pointer; display: inline-flex; align-items: center; } @media (max-width: 520px) { body { padding: 16px; } .form-card { padding: 36px 28px; margin: 0; max-width: 100%; } .form-card h3 { font-size: 1.5rem; margin-bottom: 32px; } }`.trim();
    }

    generateFormJS(fields) {
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
                " // Run immediately — DOMContentLoaded already fired",
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
            " // Bind submit directly — DOMContentLoaded has already fired",
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

    normalizeApexError(error) {
        try {
            if (typeof error === 'string') return error;
            if (Array.isArray(error?.body)) return error.body.map(e => e.message).join(', ');
            return error?.body?.message || error?.message || 'Unknown error';
        } catch (e) {
            return 'Unknown error: ' + e.message;
        }
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}