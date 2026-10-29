# Smart Forms & Surveys (native)

A 100% native Salesforce form builder. Admins build forms on top of any Salesforce object, publish them on a public Salesforce Site, and every visitor submission creates (or updates) a real Salesforce record. No external services, no callouts.

- **Build** a form by picking an object and its fields, ordering them, adding labels, placeholders, required flags and "show only for certain answers" rules.
- **Publish** it as a public link (Salesforce Site + Visualforce page), no visitor login needed.
- **Track** every submission, the record it created or updated, or the error that stopped it.

## Contents

- [Features](#features)
- [Package information](#package-information)
- [Installation](#installation)
- [One-time setup (after install)](#one-time-setup-after-install)
- [Using the app](#using-the-app)
- [Architecture](#architecture)
- [Security](#security)
- [Development](#development)
- [Testing and quality gates](#testing-and-quality-gates)
- [Creating a package version](#creating-a-package-version)
- [Release notes](#release-notes)
- [Support](#support)

## Features

The **Smart Forms & Surveys (native)** app has one tab with a left sidebar and six views:

| View | What it does |
| --- | --- |
| **Get started** | Checks the public site is Active, includes a site-name checker and the 5-step setup guide, and starts a new form or opens an existing one. |
| **Form Builder** | Merged workspace: field picker, canvas with reordering, side drawer to edit a field (label, placeholder, required, conditional visibility with a live "Try it"), and a Visitor view preview. **Save & generate form** publishes it and bumps the version. |
| **Forms** | Every saved form with its object, version and public link, copy / open actions, a visitor preview (including the "Form Not Found" page) and *Edit in Form Builder*. |
| **Submissions** | Everything visitors sent: readable or raw JSON payload, the record each submission created or updated (click to open) and the error message for failures. Filter by All / Record saved / Has error. |
| **Help & FAQ** | Searchable step-by-step guides and FAQ. |
| **Contact** | Support and inquiry channels with copy and open actions. |

Supported field types: text, email, phone, URL, number, currency, percent, picklist, multi-select picklist, date, date/time, checkbox and long text. A field can depend on one picklist or checkbox, with one or more answers that reveal it.

## Package information

| | |
| --- | --- |
| Package name | Smart Forms & Surveys |
| Package type | Managed 2GP (second-generation) |
| Namespace | `twinforce` |
| Package Id | `0HoOW00000000Uf0AI` |
| Latest version | **0.5.0.1** (Released) |
| Subscriber package version Id | `04tOW00000Ld3JiYAJ` |
| Ancestor (upgrade path from) | 0.4.0.2 (`04tOW00000JT15rYAD`, released) |
| Apex code coverage | 87% |
| Source API version | 65.0 |
| Dev Hub | `reviewdemo` |

Install links for 0.5.0.1:

- Production / Developer Edition (also the link for new installs anywhere): `https://login.salesforce.com/packaging/installPackage.apexp?p0=04tOW00000Ld3JiYAJ`
- Sandbox / scratch org: `https://test.salesforce.com/packaging/installPackage.apexp?p0=04tOW00000Ld3JiYAJ`

> 0.5.0.1 is a **released** version, so it can be installed in production as well as in sandboxes, scratch orgs and Developer Edition orgs. A released version is immutable; ship fixes as a new version.

## Installation

Using the Salesforce CLI:

```sh
sf package install --package 04tOW00000Ld3JiYAJ --target-org <your-org> --security-type AdminsOnly --wait 20
```

Or open one of the install links above. After installation:

1. Assign the **FormBuilder_Admin** permission set to everyone who builds forms and reviews submissions.
2. Open the **Smart Forms & Surveys (native)** app from the App Launcher.

```sh
sf org assign permset --name FormBuilder_Admin --target-org <your-org>
```

> Never assign `FormBuilder_Admin` to the site guest user. It exposes every form and submission.

## One-time setup (after install)

The app walks you through this on the **Get started** tab (**Setup instructions**). In short:

1. **Builder access:** assign `FormBuilder_Admin` (above).
2. **Public site:** *Setup > Sites > New*, Site Label `PublicForm`, Active Site Home Page `PublicForm`, tick **Active**.
3. **Visitor access:** *Sites > PublicForm > Public Access Settings*: enable Apex class `twinforce.FormController` and Visualforce page `twinforce.PublicForm`, then give the site guest user the **Form Builder Guest** permission set.
4. **Sharing rule:** *Setup > Sharing Settings > Form Sharing Rules > New*: Guest user access, based on criteria, **Is Public** equals **True**, share with the `PublicForm` Site Guest User, **Read Only**. (A reference copy of the rule is in `main/default/sharingRules/`; it is excluded from deploys and the package because it is bound to your Site.)
5. **Link address:** *Setup > Custom Settings > Form Builder Settings > Manage*: set **Public Form Base Url** to your Site URL followed by `?id=`, for example `https://yourorg.my.salesforce-sites.com/?id=`.

Back in the app, click **Recheck**. When the card turns green you can build forms.

## Using the app

1. **Get started:** choose *Create a new form* (or *Edit an existing form*), enter a name and the object each response should create, then **Next: build form**. Required fields are added for you.
2. **Form Builder:** tick the fields you want, reorder them, use the pencil to edit a field, preview with **Visitor view**, then **Save & generate form**. Every save of an existing form increases its version by one.
3. **Forms:** copy the public link or open it, and share it.
4. **Submissions:** check what visitors sent and the record created. If a submission shows an error, fix the form and save it again.

## Architecture

```
main/default
├── applications/      Smart Forms & Surveys (native) app (API name VFFormBuilder)
├── classes/           Apex controllers, services and tests
├── lwc/               Lightning Web Components (see below)
├── objects/           Form__c, Form_Submission__c, Form_Submission_Record__c, Form_Builder_Settings__c
├── pages/             PublicForm.page (public form renderer)
├── permissionsets/    FormBuilder_Admin, FormBuilder_Guest
├── staticresources/   DOMPurify (HTML sanitizer for the public page)
├── tabs/              Smart_Forms tab
└── triggers/          FormSubmissionTrigger
```

**App components** (`main/default/lwc`)

| Component | Role |
| --- | --- |
| `smartFormsApp` | App shell: left sidebar navigation and routing between views (tab entry point). |
| `smartFormsStart` / `smartFormsBuilder` / `smartFormsForms` / `smartFormsSubmissions` / `smartFormsHelp` / `smartFormsContact` | The six views. |
| `smartFormsVisitor` | Interactive preview of the public form (rendered natively, no `innerHTML`). |
| `smartFormsModel` | Pure logic: field and dependency rules, safe text helpers, and the generators for the public form's HTML, CSS and JS. |
| `smartFormsShared`, `smartFormsIcon` | Shared styles (CSS module) and icons. |
| `publicFormInstructionsModal` | The setup guide. |

The original `formConfigurator`, `formEditor`, `formPreviewer`, `publicFormConfiguratorGate`, `siteNameVerifier` and `formOpenPublicForm` components are still in the package and unchanged functionally.

**Apex**

| Class | Role |
| --- | --- |
| `SmartFormsDataController` | Read-only data for Forms and Submissions (`with sharing`, `WITH USER_MODE`). |
| `FormAuraController`, `FormEditorController`, `FormEditorMetadataService` | Save forms, load templates, object and field describe. |
| `FormController` | Public page controller and the visitor submission endpoint. |
| `FormSubmissionHandler` / `FormSubmissionProcessor` / `FormSubmissionTrigger` | Turn a submission into Salesforce records and record the result. |
| `SiteNameCheckController`, `FormBuilderSettingsService` | Site readiness checks and the public link setting. |

## Security

- All authenticated Apex is `with sharing`, uses `WITH USER_MODE` queries and `as user` DML, so object permissions, field-level security and sharing apply.
- The public page runs generated HTML through server-side sanitizers and **DOMPurify 3.4.17** before it is inserted, and generated markup escapes all labels, names, placeholders and picklist values.
- Visitor submissions are written in user mode through a `with sharing` helper. Only one read (rendering a published form) uses `SYSTEM_MODE`, in a private `without sharing` inner class with a documented justification.
- The guest user only needs one Apex class (`FormController`), one Visualforce page (`PublicForm`) and the **Form Builder Guest** permission set.
- Visitor-supplied payloads are rendered as text only in the Submissions view.
- Never grant the guest user other Form Builder classes or `FormBuilder_Admin`.

## Development

Prerequisites: [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`), Node.js 18+, access to the Dev Hub that owns the `twinforce` namespace.

```sh
git clone https://github.com/DemoProjectDjango/Smart-Form-Builder.git
cd Smart-Form-Builder
npm install

# Authorize the Dev Hub and create a namespaced scratch org
sf org login web --set-default-dev-hub --alias reviewdemo
sf org create scratch --definition-file config/project-scratch-def.json \
  --alias sfb-scratch --set-default --duration-days 7 --target-dev-hub reviewdemo

# Deploy, assign the permission set, open the org
sf project deploy start --source-dir main --target-org sfb-scratch
sf org assign permset --name FormBuilder_Admin --target-org sfb-scratch
sf org open --target-org sfb-scratch
```

In the scratch org, open the **Smart Forms & Surveys (native)** app. The *Get started* tab shows "Setup required" until a Site named `PublicForm` exists; follow the setup guide.

`sfdx-project.json` holds the package definition (`Smart Forms & Surveys`, namespace `twinforce`, version `0.5.0.NEXT`, ancestor `HIGHEST`). `.forceignore` excludes tests, `jsconfig.json`, and the Site-bound sharing rule from deploys and packaging.

## Testing and quality gates

```sh
# LWC unit tests (Jest)
npm run test:unit

# Apex tests (in your scratch org)
sf apex run test --test-level RunLocalTests --code-coverage --result-format human --wait 20 --target-org sfb-scratch

# Static analysis, including security and AppExchange rules
sf code-analyzer run --workspace main --target main/default/classes --target main/default/lwc \
  --rule-selector Recommended --rule-selector Security --rule-selector AppExchange
```

Current status (0.5.0.1): 72 Jest tests pass; 68 Apex tests pass with 87% overall coverage; Code Analyzer reports 0 security findings (`sfge`, `retire-js` and all high-severity rules). The remaining informational findings are `slds/no-hardcoded-values-slds2` style hints from the custom design and three code-complexity notes in older classes.

## Creating a package version

```sh
# Create a beta version (runs Apex tests and computes code coverage)
sf package version create --package "Smart Forms & Surveys" \
  --installation-key-bypass --code-coverage --wait 120 --target-dev-hub reviewdemo

# Check status or details
sf package version create list --target-dev-hub reviewdemo
sf package version report --package <04t-id> --target-dev-hub reviewdemo

# Promote a validated beta to Released (required for production installs; irreversible)
sf package version promote --package <04t-id> --target-dev-hub reviewdemo
```

Update `versionNumber` in `sfdx-project.json` (for example `0.6.0.NEXT`) before creating a new minor or major version. `ancestorVersion: HIGHEST` links each version to the highest released one so subscribers can upgrade.

## Release notes

### 0.5.0.1 (released)

- Redesigned app: single *Smart Forms & Surveys (native)* tab with left sidebar navigation, primary color `#0070d2`.
- New merged **Form Builder**, plus **Forms**, **Submissions**, **Help & FAQ** and **Contact** views.
- New `SmartFormsDataController` (read-only, user mode) with tests.
- Security: DOMPurify upgraded from 3.4.0 to 3.4.17; visitor submissions and builder saves now use `as user` DML; the guest submission write moved out of the `without sharing` class; generated form markup escapes user-controlled text.
- The Site-bound guest sharing rule is no longer part of deploys or the package (see setup step 4).

## Support

Twinstack: https://twinstack.net, info@twinstack.net.
