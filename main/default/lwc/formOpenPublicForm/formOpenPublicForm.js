import { LightningElement, api, wire, track } from "lwc";
import getPublicFormBaseUrl from "@salesforce/apex/FormBuilderSettingsService.getPublicFormBaseUrl";

export default class FormOpenPublicForm extends LightningElement {
  @api recordId;

  @track baseUrlValue = "";

  @wire(getPublicFormBaseUrl)
  wiredBaseUrl({ data, error }) {
    if (data) {
      this.baseUrlValue = (data || "").trim();
    } else if (error) {
      this.baseUrlValue = "";
    }
  }

  get baseUrl() {
    return (this.baseUrlValue || "").trim();
  }

  get isDisabled() {
    return !this.recordId || !this.baseUrl;
  }

  get showHint() {
    return !this.baseUrl;
  }

  handleOpen() {
    const url = `${this.baseUrl}${this.recordId}`;
    window.open(url, "_blank");
  }
}