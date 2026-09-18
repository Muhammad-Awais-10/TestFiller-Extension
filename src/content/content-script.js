(() => {
  if (globalThis.WebPloverContentScriptInstalled) return;
  globalThis.WebPloverContentScriptInstalled = true;
  const PROTECTED_HINT = /\b(password|passcode|login|log[ -]?in|sign[ -]?in|username|user[ -]?name|otp|one[ -]?time|verification|verify|captcha|card|credit|debit|cvv|cvc|iban|bank|routing|account number|tax|ssn|social security|passport|driver.?s? licen[cs]e|national id)\b/i;
  const PROTECTED_INPUT_TYPES = ["password", "hidden", "file", "submit", "button", "reset", "checkbox", "radio", "image", "date", "datetime-local", "time", "month", "week", "range", "color", "search"];
  const PROTECTED_AUTOCOMPLETE = new Set(["one-time-code", "cc-number", "cc-csc", "cc-exp", "cc-exp-month", "cc-exp-year", "cc-type"]);
  const PROTECTED_INPUT_MARKERS = /(^|[^a-z])(captcha|recaptcha|hcaptcha)([^a-z]|$)/i;
  const PHONE_HINT = /\b(phone|telephone|mobile|cell|whats?app|fax|tel|contact[ _-]?(number|no|#)?|mobile[ _-]?(number|no|#)?|phone[ _-]?(number|no|#)?)\b/i;
  const COUNTRY_ALIASES = { US: ["us", "united states", "united states of america"], CA: ["ca", "canada"], GB: ["gb", "uk", "united kingdom", "great britain"], AU: ["au", "australia"] };
  const FIELD_RULES = {
    firstName: { autocomplete: ["given-name"], hint: /\b(first|given|forename)[ _-]?name\b/i },
    lastName: { autocomplete: ["family-name", "last-name"], hint: /\b(last|family|surname)[ _-]?name\b/i },
    fullName: { autocomplete: ["name"], hint: /\b(full[ _-]?name|your name|contact name|customer name|name)\b/i },
    email: { autocomplete: ["email"], hint: /\b(e-?mail|email address|your email|mail[ _-]?id)\b/i },
    phone: { autocomplete: ["tel", "tel-national", "tel-country-code"], hint: PHONE_HINT },
    company: { autocomplete: ["organization"], hint: /\b(company|organisation|organization|business)\b/i },
    address1: { autocomplete: ["address-line1", "street-address"], hint: /\b(address[ _-]?(line)?[ _-]?1|street address|street)\b/i },
    address2: { autocomplete: ["address-line2"], hint: /\b(address[ _-]?(line)?[ _-]?2|suite|unit|apartment|apt)\b/i },
    city: { autocomplete: ["address-level2"], hint: /\b(city|town)\b/i },
    stateRegion: { autocomplete: ["address-level1"], hint: /\b(state|province|region|county)\b/i },
    postalCode: { autocomplete: ["postal-code"], hint: /\b(zip|postal[ _-]?code|postcode)\b/i },
    country: { autocomplete: ["country", "country-name"], hint: /\bcountry\b/i },
    website: { autocomplete: ["url"], hint: /\b(website|web[ _-]?site|url|homepage)\b/i },
    jobTitle: { autocomplete: ["organization-title"], hint: /\b(job[ _-]?title|position|designation|profession|occupation)\b/i },
    message: { autocomplete: [], hint: /\b(message|comment|notes?|description|inquir(?:y|ies))\b/i }
  };
  const FILL_ORDER = ["country", "stateRegion", "firstName", "lastName", "fullName", "email", "phone", "company", "address1", "address2", "city", "postalCode", "website", "jobTitle", "message"];

  function visible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function labelText(element) {
    const labels = element.labels ? Array.from(element.labels).map((label) => label.textContent) : [];
    return labels.join(" ");
  }

  function accessibleLabelText(element) {
    const labelledBy = String(element.getAttribute?.("aria-labelledby") || "").trim();
    const referencedLabels = labelledBy.split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)).filter(Boolean).map((label) => label.textContent || "");
    const labels = element.labels ? Array.from(element.labels).map((label) => label.textContent || "") : [];
    const wrappingLabel = element.closest?.("label")?.textContent || "";
    const uniqueLabels = [...new Set([...labels, wrappingLabel].map((label) => label.trim()).filter(Boolean))];
    return {
      label: uniqueLabels.join(" ").trim(),
      ariaLabel: String(element.getAttribute?.("aria-label") || "").trim(),
      ariaLabelledBy: referencedLabels.join(" ").trim()
    };
  }

  function collectFieldSignals(element) {
    const accessible = accessibleLabelText(element);
    return {
      type: String(element.type || "").trim(),
      autocomplete: String(element.getAttribute?.("autocomplete") || "").trim(),
      name: String(element.name || "").trim(),
      id: String(element.id || "").trim(),
      label: accessible.label,
      ariaLabel: accessible.ariaLabel,
      ariaLabelledBy: accessible.ariaLabelledBy,
      placeholder: String(element.placeholder || element.getAttribute?.("placeholder") || "").trim(),
      className: String(element.className || "").trim(),
      nearbyText: [element.previousElementSibling, element.parentElement?.previousElementSibling]
        .filter(Boolean).map((item) => item.textContent || "").join(" ").trim()
    };
  }

  function normalizeFieldText(value) {
    return String(value || "")
      .trim()
      .replace(/([a-z\d])([A-Z])/g, "$1 $2")
      .replace(/([A-Za-z])(\d)/g, "$1 $2")
      .replace(/(\d)([A-Za-z])/g, "$1 $2")
      .replace(/[\s_-]+/g, " ")
      .replace(/[^\w ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function compactFieldText(value) {
    return normalizeFieldText(value).replace(/ /g, "");
  }

  function normalizeFieldSignals(signals) {
    const raw = { ...signals };
    const fields = Object.keys(raw).filter((key) => key !== "type");
    const tokens = Object.fromEntries(fields.map((key) => [key, normalizeFieldText(raw[key])]));
    const compact = Object.fromEntries(fields.map((key) => [key, compactFieldText(raw[key])]));
    return { raw, tokens, compact };
  }

  function isExplicitPhoneField(element) {
    const signals = collectFieldSignals(element);
    const accepted = new Set(["mobile", "mobile number", "phone", "phone number", "cell", "cell number"]);
    return [signals.label, signals.placeholder].some((value) => accepted.has(normalizeFieldText(value)));
  }

  const CANONICAL_FIELD_TYPES = Object.freeze({
    firstName: "firstName", lastName: "lastName", fullName: "fullName", email: "email", confirmEmail: "confirmEmail", phone: "phone",
    company: "company", department: "department", jobTitle: "jobTitle", address1: "address1", address2: "address2", city: "city",
    state: "state", country: "country", postalCode: "postalCode", website: "website", username: "username", password: "password",
    confirmPassword: "confirmPassword", passport: "passport", nationalId: "nationalId", employeeId: "employeeId", taxId: "taxId",
    accountNumber: "accountNumber", message: "message", genericText: "genericText", number: "number", decimal: "decimal",
    percentage: "percentage", age: "age", quantity: "quantity", price: "price", date: "date", dateTime: "dateTime", time: "time",
    month: "month", week: "week", range: "range", color: "color"
  });
  const FIELD_ALIASES = Object.freeze({
    firstName: ["first name", "firstname", "given name", "givenname", "forename", "fname"],
    lastName: ["last name", "lastname", "surname", "family name", "familyname", "second name", "secondname", "lname"],
    fullName: ["full name", "fullname", "contact name", "contactname", "customer name", "customername", "applicant name", "applicantname", "person name", "personname", "your name", "yourname", "name"],
    email: ["email", "email address", "emailaddress", "e mail", "mail", "mail id", "mailid"],
    confirmEmail: ["confirm email", "confirmemail", "repeat email", "repeatemail", "reenter email", "reenteremail", "retype email", "retypeemail", "verify email", "verifyemail"],
    phone: ["phone", "phone number", "phonenumber", "telephone", "telephone number", "telephonenumber", "tel", "mobile", "mobile number", "mobilenumber", "cell", "cell phone", "cellphone", "whatsapp", "contact number", "contactnumber", "fax"],
    company: ["company", "company name", "companyname", "organization", "organization name", "organizationname", "organisation", "organisation name", "organisationname", "business", "business name", "businessname", "employer"],
    department: ["department", "dept", "division", "team"], jobTitle: ["job title", "jobtitle", "title", "position", "designation", "role", "occupation", "profession"],
    address1: ["address", "address 1", "address1", "address line 1", "addressline1", "street address", "streetaddress", "street", "mailing address", "mailingaddress"],
    address2: ["address 2", "address2", "address line 2", "addressline2", "apartment", "apartment number", "apartmentnumber", "apt", "suite", "unit"],
    city: ["city", "town"], state: ["state", "province", "region", "county"], country: ["country", "nation"],
    postalCode: ["postal code", "postalcode", "postcode", "post code", "zip", "zip code", "zipcode"], website: ["website", "web site", "site", "url", "web address", "webaddress", "homepage", "website url", "web url"],
    username: ["username", "user name", "user id", "userid", "login name", "loginname"], password: ["password", "pass word", "passwd"],
    confirmPassword: ["confirm password", "confirmpassword", "repeat password", "repeatpassword", "reenter password", "reenterpassword", "retype password", "retypepassword", "verify password", "verifypassword"],
    passport: ["passport", "passport number", "passportnumber", "passport no", "passportno"], nationalId: ["national id", "nationalid", "national identity", "nationalidentity", "identity number", "identitynumber", "id number", "idnumber", "cnic"],
    employeeId: ["employee id", "employeeid", "staff id", "staffid", "worker id", "workerid"], taxId: ["tax id", "taxid", "tax number", "taxnumber", "vat number", "vatnumber"], accountNumber: ["account number", "accountnumber", "account no", "accountno"],
    message: ["message", "comments", "comment", "notes", "note", "description", "details", "enquiry", "inquiry"], genericText: [],
    number: ["number", "numeric", "value"], decimal: ["decimal"], percentage: ["percentage", "percent", "pct"], age: ["age"], quantity: ["quantity", "qty", "count"], price: ["price", "amount", "cost", "rate", "income"],
    date: ["date"], dateTime: ["datetime", "date time"], time: ["time"], month: ["month"], week: ["week"], range: ["range"], color: ["color", "colour"]
  });
  const GENERIC_FIELD_ALIASES = new Set(["name", "title", "number", "value", "address", "date", "time"]);
  const TECHNICAL_FIELD_PREFIXES = Object.freeze(["txt", "input", "inp", "field", "fld"]);
  const CONTEXTUAL_FIELD_MODIFIERS = new Set(["user", "customer", "contact", "applicant", "client", "member", "billing", "shipping", "primary", "secondary", "work", "home", "office", "personal", "profile", "display", "company", "organization", "organisation", "business", "emergency", "alternate", "preferred", "job"]);

  function getAliasesForFieldType(type) {
    return (FIELD_ALIASES[type] || []).slice();
  }

  function fieldAliasMatches(normalizedValue, alias) {
    const valueTokens = normalizeFieldText(normalizedValue);
    const aliasTokens = normalizeFieldText(alias);
    return valueTokens === aliasTokens || compactFieldText(valueTokens) === compactFieldText(aliasTokens);
  }

  function findAliasMatches(normalizedSignal) {
    return Object.entries(FIELD_ALIASES).filter(([, aliases]) => aliases.some((alias) => fieldAliasMatches(normalizedSignal, alias))).map(([type]) => type);
  }

  const SIGNAL_WEIGHTS = Object.freeze({ type: 120, autocomplete: 115, label: 100, ariaLabel: 100, ariaLabelledBy: 100, name: 90, id: 85, placeholder: 55, className: 20, nearbyText: 5 });
  const CLASSIFICATION_PRIORITY = Object.freeze(["confirmEmail", "confirmPassword", "firstName", "lastName", "address2", "postalCode", "phone", "price", "quantity", "age", "percentage", "decimal", "fullName", "email", "company", "department", "jobTitle", "address1", "city", "state", "country", "website", "username", "password", "passport", "nationalId", "employeeId", "taxId", "accountNumber", "message", "dateTime", "date", "time", "month", "week", "range", "color", "number"]);
  const AUTOCOMPLETE_TYPES = Object.freeze({ "given-name": "firstName", "family-name": "lastName", "name": "fullName", email: "email", tel: "phone", "tel-national": "phone", "tel-local": "phone", "tel-country-code": "phone", organization: "company", "organization-title": "jobTitle", "street-address": "address1", "address-line1": "address1", "address-line2": "address2", "address-level2": "city", "address-level1": "state", country: "country", "country-name": "country", "postal-code": "postalCode", url: "website", username: "username", "current-password": "password", "new-password": "password" });
  const HTML_TYPE_TYPES = Object.freeze({ email: "email", tel: "phone", url: "website", date: "date", "datetime-local": "dateTime", time: "time", month: "month", week: "week", range: "range", color: "color", password: "password" });

  function autocompleteFieldType(rawAutocomplete) {
    const tokens = String(rawAutocomplete || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    return tokens.map((token) => AUTOCOMPLETE_TYPES[token]).find(Boolean) || null;
  }

  function semanticIdentityCandidates(value) {
    const original = normalizeFieldText(value);
    const technical = TECHNICAL_FIELD_PREFIXES.reduce((candidate, prefix) => {
      const prefixCompact = compactFieldText(prefix);
      return candidate.startsWith(`${prefixCompact}`) ? candidate.slice(prefixCompact.length).trim() : candidate;
    }, original);
    const words = technical.split(" ").filter(Boolean);
    const contextual = [];
    let start = 0;
    let end = words.length;
    while (start < end && CONTEXTUAL_FIELD_MODIFIERS.has(words[start])) start += 1;
    while (end > start && CONTEXTUAL_FIELD_MODIFIERS.has(words[end - 1])) end -= 1;
    if (start || end !== words.length) contextual.push(words.slice(start, end).join(" "));
    return [...new Set([original, technical, ...contextual].filter(Boolean))];
  }

  function classifyNormalizedFieldSignals(normalizedSignals) {
    const candidates = [];
    const raw = normalizedSignals.raw || {};
    const sourceNames = ["autocomplete", "label", "ariaLabel", "ariaLabelledBy", "name", "id", "placeholder", "className", "nearbyText"];
    const addCandidate = (type, score, source, alias, aliasStrength = "specific") => {
      if (score < 50) return;
      candidates.push({ type, score, source, alias, aliasStrength });
    };
    const type = String(raw.type || "").toLowerCase();
    if (HTML_TYPE_TYPES[type]) addCandidate(HTML_TYPE_TYPES[type], SIGNAL_WEIGHTS.type, "type", type);
    const autocomplete = autocompleteFieldType(raw.autocomplete);
    if (autocomplete) addCandidate(autocomplete, SIGNAL_WEIGHTS.autocomplete, "autocomplete", String(raw.autocomplete || "").trim().toLowerCase().split(/\s+/).find((token) => AUTOCOMPLETE_TYPES[token] === autocomplete));
    for (const source of sourceNames.slice(1)) {
      const value = normalizedSignals.tokens?.[source] || normalizeFieldText(raw[source]);
      if (!value) continue;
      const contextualSource = ["label", "ariaLabel", "ariaLabelledBy", "name", "id", "placeholder"].includes(source);
      for (const semanticValue of contextualSource ? semanticIdentityCandidates(value) : [value]) {
        for (const matchedType of findAliasMatches(semanticValue)) {
          const alias = getAliasesForFieldType(matchedType).find((item) => fieldAliasMatches(semanticValue, item));
          const aliasStrength = GENERIC_FIELD_ALIASES.has(compactFieldText(alias)) ? "generic" : "specific";
          addCandidate(matchedType, SIGNAL_WEIGHTS[source] - (aliasStrength === "generic" ? 20 : 0), source, alias, aliasStrength);
        }
      }
    }
    if (type === "number") {
      const numericTypes = new Set(["postalCode", "price", "quantity", "age", "percentage", "decimal", "number"]);
      for (let index = candidates.length - 1; index >= 0; index -= 1) if (candidates[index].source !== "type" && !numericTypes.has(candidates[index].type)) candidates.splice(index, 1);
      if (!candidates.some((candidate) => candidate.source !== "type")) addCandidate("number", 50, "type", type);
    }
    const confirmSource = new Set(["autocomplete", "label", "ariaLabel", "ariaLabelledBy", "name", "id", "placeholder"]);
    const specialization = type === "email" ? "confirmEmail" : type === "password" ? "confirmPassword" : null;
    const specializedCandidate = specialization && candidates.find((candidate) => candidate.type === specialization && confirmSource.has(candidate.source));
    if (specializedCandidate) specializedCandidate.score = SIGNAL_WEIGHTS.type + 1;
    const bestByType = new Map();
    for (const candidate of candidates) {
      const current = bestByType.get(candidate.type);
      if (!current || candidate.score > current.score || (candidate.score === current.score && CLASSIFICATION_PRIORITY.indexOf(candidate.type) < CLASSIFICATION_PRIORITY.indexOf(current.type))) bestByType.set(candidate.type, candidate);
    }
    const ranked = [...bestByType.values()].sort((a, b) => b.score - a.score || CLASSIFICATION_PRIORITY.indexOf(a.type) - CLASSIFICATION_PRIORITY.indexOf(b.type));
    const winner = ranked[0] || null;
    return { type: winner?.type || null, score: winner?.score || 0, source: winner?.source || null, alias: winner?.alias || null, aliasStrength: winner?.aliasStrength || null, candidates: ranked };
  }

  function runtimeFieldTypeFor(type) {
    if (type === "confirmEmail") return "email";
    if (type === "confirmPassword") return "password";
    if (type === "state") return "stateRegion";
    return type;
  }

  globalThis.WebPloverFieldSignals = { collectFieldSignals, normalizeFieldText, compactFieldText, normalizeFieldSignals, isExplicitPhoneField, CANONICAL_FIELD_TYPES, FIELD_ALIASES, GENERIC_FIELD_ALIASES, TECHNICAL_FIELD_PREFIXES, getAliasesForFieldType, fieldAliasMatches, findAliasMatches, autocompleteFieldType, classifyNormalizedFieldSignals, runtimeFieldTypeFor, isStructurallyFillable, protectedFieldReason };

  function hints(element) {
    const nearby = [element.previousElementSibling, element.parentElement?.previousElementSibling, element.parentElement?.querySelector("label")]
      .filter(Boolean).map((item) => item.textContent).join(" ");
    return [element.name, element.id, element.className, element.placeholder, element.getAttribute("aria-label"), labelText(element), nearby].join(" ");
  }

  function isStructurallyFillable(element) {
    if (!element || element.disabled || element.readOnly || !visible(element)) return false;
    return !PROTECTED_INPUT_TYPES.includes((element.type || "").toLowerCase());
  }

  function protectedFieldReason(element) {
    if (!element) return null;
    const signals = collectFieldSignals(element);
    const autocompleteTokens = String(signals.autocomplete || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (autocompleteTokens.some((token) => PROTECTED_AUTOCOMPLETE.has(token))) return autocompleteTokens.find((token) => PROTECTED_AUTOCOMPLETE.has(token)) === "one-time-code" ? "otp" : "payment-card";
    const semanticText = [signals.name, signals.id, signals.label, signals.ariaLabel, signals.ariaLabelledBy, signals.placeholder].map((value) => normalizeFieldText(value)).join(" ");
    if (/\b(otp|one time( code)?|authentication code|security code|verification code|passcode)\b/i.test(semanticText)) return "otp";
    if (/\b(ssn|social security( number)?)\b/i.test(semanticText)) return "social-security";
    if (/(^|[^a-z])(captcha|recaptcha|hcaptcha)([^a-z]|$)/i.test(semanticText) || PROTECTED_INPUT_MARKERS.test(String(signals.className || ""))) return "captcha";
    if (/\b(credit card|debit card|card number|card security code|card verification code|cvv|cvc)\b/i.test(semanticText)) return "payment-card";
    if (/\b(iban|routing number|bank account|swift|bic)\b/i.test(semanticText)) return "banking";
    if (/\b(driver[ -]?s license|driver license)\b/i.test(semanticText)) return "driver-license";
    return null;
  }

  function eligible(element) {
    return isStructurallyFillable(element) && !protectedFieldReason(element);
  }

  function compatible(element, key) {
    const type = (element.type || "").toLowerCase();
    if (element instanceof HTMLInputElement && !["", "text", "email", "tel", "number", "url"].includes(type)) return false;
    if (type === "number") return key === "phone" || key === "postalCode";
    if (type === "email") return key === "email";
    if (type === "tel") return key === "phone";
    if (type === "url") return key === "website";
    return true;
  }

  function plainTextField(element) {
    const type = (element.type || "").toLowerCase();
    return (element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && ["", "text"].includes(type)) || messageField(element)) && !PHONE_HINT.test(hints(element));
  }

  const filledValues = new WeakMap();
  const filledIdentities = new Map();

  function fieldValue(element) {
    return element.isContentEditable ? element.textContent : String(element.value || "");
  }

  function normalizeTrackedValue(element, value) {
    const text = String(value || "").trim();
    const type = (element.type || "").toLowerCase();
    if (isExplicitPhoneField(element)) return text.replace(/\D+/g, "");
    if (type === "tel") return text.replace(/\D+/g, "");
    if (type === "number") return text === "" ? "" : String(Number(text));
    return text;
  }

  function normalizeIdentityPart(value) {
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  }

  function fieldIdentityKeys(element) {
    const type = normalizeIdentityPart(element.type || "");
    const autocomplete = normalizeIdentityPart(element.getAttribute("autocomplete") || "");
    const label = normalizeIdentityPart(labelText(element));
    const placeholder = isExplicitPhoneField(element) ? normalizeIdentityPart(element.placeholder || element.getAttribute("placeholder") || "") : "";
    const aria = normalizeIdentityPart(element.getAttribute("aria-label") || "");
    const dataSlug = normalizeIdentityPart(element.getAttribute("data-slug") || "");
    const name = normalizeIdentityPart(element.name || "");
    const id = normalizeIdentityPart(element.id || "");
    const keys = [];
    if (name) keys.push(`name:${name}`);
    if (dataSlug) keys.push(`slug:${dataSlug}`);
    if (autocomplete) keys.push(`autocomplete:${autocomplete}`);
    if (aria) keys.push(`aria:${aria}`);
    if (label) keys.push(`label:${label}`);
    if (placeholder && type) keys.push(`phone-placeholder:${placeholder}|type:${type}`);
    if (id) keys.push(`id:${id}`);
    if (name && type) keys.push(`name:${name}|type:${type}`);
    if (dataSlug && type) keys.push(`slug:${dataSlug}|type:${type}`);
    if (autocomplete && type) keys.push(`autocomplete:${autocomplete}|type:${type}`);
    if (aria && type) keys.push(`aria:${aria}|type:${type}`);
    if (label && type) keys.push(`label:${label}|type:${type}`);
    if (id && type) keys.push(`id:${id}|type:${type}`);
    return keys;
  }

  function trackedValue(element) {
    const keys = fieldIdentityKeys(element);
    for (const key of keys) {
      if (filledIdentities.has(key)) return filledIdentities.get(key);
    }
    return filledValues.get(element) || "";
  }

  function canFill(element) {
    const current = fieldValue(element);
    if (!current.trim()) return true;
    const tracked = normalizeTrackedValue(element, trackedValue(element));
    return tracked && normalizeTrackedValue(element, current) === tracked;
  }

  function allCandidates(root = document) {
    const candidates = Array.from(root.querySelectorAll("input, textarea, select, [contenteditable=\"true\"]"));
    if (root.querySelectorAll) {
      candidates.push(...Array.from(root.querySelectorAll("[role=radio], [role=checkbox], [role=listbox], [role=option], [role=button], [aria-haspopup=listbox], [aria-haspopup=menu], button, [tabindex]:not(input):not(textarea):not(select)")));
    }
    for (const host of root.querySelectorAll("*")) if (host.shadowRoot) candidates.push(...allCandidates(host.shadowRoot));
    return candidates;
  }

  function isHiddenLike(element) {
    return element.hidden || element.getAttribute("aria-hidden") === "true" || element.getAttribute("data-disabled") === "true" || !visible(element);
  }

  function roleText(element) {
    return [element.textContent, element.getAttribute("aria-label"), element.getAttribute("data-value")].filter(Boolean).join(" ");
  }

  function clickableTarget(element) {
    if (element && typeof element.click === "function") return element;
    return null;
  }

  function forbiddenAction(element) {
    const text = roleText(element).trim().toLowerCase();
    return /\b(next|back|submit|clear form|submit form|previous|continue)\b/.test(text);
  }

  function selectableLabel(element) {
    return [element.getAttribute("aria-label"), element.textContent, element.getAttribute("data-value")].filter(Boolean).join(" ").trim().toLowerCase();
  }

  function selectOptionByClick(option) {
    const target = clickableTarget(option);
    if (!target || isHiddenLike(target) || forbiddenAction(target)) return false;
    target.click();
    dispatchChange(target);
    return true;
  }

  function isCustomSelectButton(element) {
    if (!element || (element.getAttribute && element.getAttribute("role")) !== "button") return false;
    const hasPopup = /^(listbox|menu)$/i.test(element.getAttribute("aria-haspopup") || "");
    const expanded = element.getAttribute("aria-expanded");
    const controls = element.getAttribute("aria-controls") || element.getAttribute("aria-owns");
    return hasPopup || (expanded !== null && controls);
  }

  function fillCustomSelectLike(element) {
    if (isHiddenLike(element) || forbiddenAction(element)) return false;
    const expanded = element.getAttribute("aria-expanded") === "true";
    const root = element.ownerDocument || document;
    const listboxId = element.getAttribute("aria-controls") || element.getAttribute("aria-owns");
    const menu = (listboxId && root.getElementById(listboxId)) || root.querySelector("[role=listbox][aria-hidden=\"false\"], [role=menu][aria-hidden=\"false\"]");
    if (!expanded && element.getAttribute("role") !== "option") {
      element.click();
      if (!menu) return true;
    }
    const options = Array.from((menu || root).querySelectorAll("[role=option], [role=menuitemradio], [role=menuitemcheckbox], [role=radio], [role=checkbox]"))
      .filter((option) => !isHiddenLike(option) && !option.closest("[aria-disabled=\"true\"], [disabled]") && !forbiddenAction(option));
    const chosen = options.find((option) => /\b(other|please select|choose|select)\b/.test(selectableLabel(option))) || options.find((option) => selectableLabel(option)) || null;
    return chosen ? selectOptionByClick(chosen) : false;
  }

  function questionRoot(element) {
    return element.closest("[role=radiogroup], [role=group], fieldset, .freebirdFormviewerViewItemsItemItem, .geS5n, .QoNYQd, .docssharedWizToggleLabeledContainer, .docssharedWizListboxRoot") || element.parentElement || element;
  }

  function groupKey(element) {
    const root = questionRoot(element);
    return [root.getAttribute("aria-label"), root.getAttribute("data-params"), root.textContent].filter(Boolean).join(" ").trim();
  }

  function randomChoice(items) {
    return items.length ? items[Math.floor(Math.random() * items.length)] : null;
  }

  function fillCustomControls(candidates) {
    const filled = [];
    const seen = new Set();
    const radios = candidates.filter((element) => (element.getAttribute && element.getAttribute("role")) === "radio" && !isHiddenLike(element) && !forbiddenAction(element) && canFill(element));
    const checks = candidates.filter((element) => (element.getAttribute && element.getAttribute("role")) === "checkbox" && !isHiddenLike(element) && !forbiddenAction(element) && canFill(element));
    const selects = candidates.filter((element) => ((element.getAttribute && element.getAttribute("role")) === "listbox" || isCustomSelectButton(element)) && !isHiddenLike(element) && !forbiddenAction(element) && canFill(element));

    for (const element of radios) {
      const key = `radio:${groupKey(element)}`;
      if (seen.has(key)) continue;
      const groupRoot = questionRoot(element);
      const options = Array.from(groupRoot.querySelectorAll("[role=radio]")).filter((option) => !isHiddenLike(option) && !forbiddenAction(option) && !/\b(other)\b/.test(selectableLabel(option)));
      const chosen = randomChoice(options);
      if (chosen && selectOptionByClick(chosen)) { seen.add(key); filled.push("radio"); }
    }

    for (const element of checks) {
      const key = `checkbox:${groupKey(element)}`;
      if (seen.has(key)) continue;
      const groupRoot = questionRoot(element);
      const options = Array.from(groupRoot.querySelectorAll("[role=checkbox]")).filter((option) => !isHiddenLike(option) && !forbiddenAction(option) && !/\b(other)\b/.test(selectableLabel(option)));
      const picks = options.slice().sort(() => Math.random() - 0.5).slice(0, Math.min(2, options.length || 0));
      let any = false;
      for (const option of picks) any = selectOptionByClick(option) || any;
      if (any) { seen.add(key); filled.push("checkbox"); }
    }

    for (const element of selects) {
      const key = `select:${groupKey(element)}`;
      if (seen.has(key)) continue;
      if (fillCustomSelectLike(element)) { seen.add(key); filled.push("dropdown"); }
    }
    return filled;
  }

  function activePopupCandidates() {
    const popups = Array.from(document.querySelectorAll(".pum-overlay, [role=dialog], [aria-modal=true]"))
      .filter(visible).sort((a, b) => Number(b.style.zIndex || 0) - Number(a.style.zIndex || 0));
    return popups.length ? allCandidates(popups[0]) : allCandidates();
  }

  function messageField(element) {
    return element instanceof HTMLTextAreaElement || (element.isContentEditable && !(element instanceof HTMLInputElement || element instanceof HTMLSelectElement));
  }

  function score(element, rule, key) {
    if (!eligible(element) || !canFill(element) || !compatible(element, key)) return -1;
    if (rule === FIELD_RULES.message && !messageField(element)) return -1;
    const autocomplete = (element.getAttribute("autocomplete") || "").toLowerCase().trim().split(/\s+/).pop();
    if (rule.autocomplete.includes(autocomplete)) return 1000;
    const type = (element.type || "").toLowerCase();
    if (rule === FIELD_RULES.email && type === "email") return 900;
    if (rule === FIELD_RULES.phone && (type === "tel" || type === "number")) return 900;
    return rule.hint.test(hints(element)) ? 700 : -1;
  }

  function knownField(element) {
    const autocomplete = (element.getAttribute("autocomplete") || "").toLowerCase().trim().split(/\s+/).pop();
    const type = (element.type || "").toLowerCase();
    return Object.entries(FIELD_RULES).some(([key, rule]) =>
      compatible(element, key) && (rule.autocomplete.includes(autocomplete) || rule.hint.test(hints(element)) ||
        (key === "email" && type === "email") || (key === "phone" && type === "tel") || (key === "website" && type === "url") ||
        (key === "fullName" && /\bname\b/i.test(hints(element))))
    );
  }

  function classifyField(element) {
    if (!eligible(element) || !canFill(element)) return null;
    if (isExplicitPhoneField(element)) return "phone";
    const semantic = classifyNormalizedFieldSignals(normalizeFieldSignals(collectFieldSignals(element)));
    return semantic.type ? runtimeFieldTypeFor(semantic.type) : null;
  }

  function fallbackValue(element, profile) {
    const type = (element.type || "").toLowerCase();
    if (type === "email") return profile?.email || "test@example.com";
    if (type === "tel") return profile?.phone || "+1 555-0100";
    if (type === "url") return profile?.website || "https://example.com";
    if (type === "number") return "42";
    return profile?.otherText || "Lorem ipsum dolor sit amet";
  }

  function numericValue(element) {
    const minAttr = element.getAttribute("min");
    const maxAttr = element.getAttribute("max");
    const stepAttr = element.getAttribute("step");
    const min = minAttr === null || minAttr === "" ? NaN : Number(minAttr);
    const max = maxAttr === null || maxAttr === "" ? NaN : Number(maxAttr);
    const step = stepAttr && stepAttr !== "any" ? Math.abs(Number(stepAttr)) : 1;
    const decimal = /\./.test(String(minAttr || "")) || /\./.test(String(maxAttr || "")) || /\./.test(String(stepAttr || ""));
    let value = Number.isFinite(min) ? min : (Number.isFinite(max) ? Math.min(decimal ? 1.5 : 42, max) : (decimal ? 1.5 : 42));
    if (!Number.isFinite(value)) value = decimal ? 1.5 : 42;
    if (Number.isFinite(min) && value < min) value = min;
    if (Number.isFinite(max) && value > max) value = max;
    if (step > 0 && Number.isFinite(min)) value = min + Math.ceil((value - min) / step) * step;
    if (Number.isFinite(max) && value > max) value = max;
    return decimal ? String(Number(value).toFixed(2).replace(/\.00$/, "")) : String(Math.round(value));
  }

  function decimalValue(element) {
    return numericValue(element);
  }

  function validFallbackValue(element, profile) {
    const type = (element.type || "").toLowerCase();
    const mode = (element.getAttribute("inputmode") || "").toLowerCase();
    const text = hints(element).toLowerCase();
    if (isExplicitPhoneField(element)) return type === "number" ? (profile?.phone || "+1 555-0100").replace(/\D/g, "") : (profile?.phone || "+1 555-0100");
    if (type === "email") return profile?.email || "test@example.com";
    if (type === "tel" || PHONE_HINT.test(text) || mode === "tel") return profile?.phone || "+1 555-0100";
    if (type === "url") return profile?.website || "https://example.com";
    if (type === "number") return numericValue(element);
    if (/percentage/.test(text)) return "50";
    if (/age/.test(text)) return "25";
    if (/quantity|qty/.test(text)) return "1";
    if (/decimal|price|amount|cost|rate|ratio/.test(text)) return decimalValue(element);
    if (/zip|postal/.test(text)) return numericValue(element);
    return profile?.otherText || "Lorem ipsum dolor sit amet";
  }

  function valueForField(key, profile, element) {
    if (key === "department") return profile?.department || "qa";
    if (key === "message") return profile?.otherText || "Lorem ipsum dolor sit amet";
    if (key === "number") return numericValue(element);
    if (key === "decimal") return decimalValue(element);
    if (key === "postal") return numericValue(element);
    if (key === "percentage") return "50";
    if (key === "age") return "25";
    if (key === "quantity") return "1";
    return profile?.[key] || fallbackValue(element, profile);
  }

  const DEFERRED_UNSUPPORTED_TYPES = new Set(["passport", "nationalId", "employeeId", "taxId", "accountNumber", "username"]);

  function deferredUnsupportedField(element) {
    const semantic = classifyNormalizedFieldSignals(normalizeFieldSignals(collectFieldSignals(element)));
    return DEFERRED_UNSUPPORTED_TYPES.has(semantic.type);
  }

  function fillSafeField(element, profile) {
    const key = classifyField(element);
    if (!key || deferredUnsupportedField(element)) return false;
    const value = valueForField(key, profile, element);
    return setValue(element, value, key === "number" ? "postalCode" : key);
  }

  function fillUnknownSafeField(element, profile) {
    if (!eligible(element) || !canFill(element)) return false;
    if (element instanceof HTMLSelectElement) return false;
    const type = (element.type || "").toLowerCase();
    if (messageField(element) || plainTextField(element) || type === "email" || type === "tel" || type === "url" || type === "number") {
      return setValue(element, validFallbackValue(element, profile), type === "number" ? "postalCode" : "message");
    }
    return false;
  }

  function fallbackKey(element) {
    const type = (element.type || "").toLowerCase();
    const text = hints(element).toLowerCase();
    if (type === "email") return "email";
    if (type === "tel" || PHONE_HINT.test(text)) return "phone";
    if (type === "url") return "website";
    if (type === "number") return /decimal|price|amount|cost|rate|ratio/.test(text) ? "decimal" : "number";
    if (/percentage/.test(text)) return "percentage";
    if (/age/.test(text)) return "age";
    if (/quantity|qty/.test(text)) return "quantity";
    if (/zip|postal/.test(text)) return "postal";
    return "text";
  }

  function fillRemainingSafeField(element, profile) {
    if (!eligible(element) || !canFill(element) || fieldValue(element).trim()) return false;
    if (element instanceof HTMLSelectElement) return false;
    const key = classifyField(element);
    const attempts = [];
    const fallback = fallbackKey(element);
    if (key) attempts.push(valueForField(key, profile, element));
    if (fallback === "decimal") attempts.push(decimalValue(element));
    if (fallback === "number" || fallback === "postal") attempts.push(numericValue(element));
    if (fallback === "percentage") attempts.push("50");
    if (fallback === "age") attempts.push("25");
    if (fallback === "quantity") attempts.push("1");
    attempts.push(validFallbackValue(element, profile));
    if (fallback === "text") attempts.push(profile?.otherText || "Lorem ipsum dolor sit amet");
    for (const value of attempts) {
      if (!value) continue;
      const before = fieldValue(element);
      if (setValue(element, value, fallback === "number" || fallback === "postal" ? "postalCode" : key || "message") && fieldValue(element).trim() && fieldValue(element) !== before) return true;
    }
    return false;
  }

  function optionValue(element, value, key) {
    const wanted = String(value).trim().toLowerCase();
    const aliases = key === "country" ? (COUNTRY_ALIASES[String(value).toUpperCase()] || [wanted])
      : key === "stateRegion" && wanted === "ca" ? ["ca", "california"] : [wanted];
    const option = Array.from(element.options).find((item) => aliases.includes(item.value.trim().toLowerCase()) || aliases.includes(item.text.trim().toLowerCase()));
    return option?.value || "";
  }

  function dispatchChange(element) {
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setValue(element, value, key) {
    const type = (element.type || "").toLowerCase();
    const nextValue = element instanceof HTMLSelectElement ? optionValue(element, value, key) : isExplicitPhoneField(element) && type === "number" ? String(value).replace(/\D/g, "") : value;
    if (!nextValue) return false;
    try {
      if (element.isContentEditable) element.textContent = nextValue;
      else {
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
        if (setter) setter.call(element, nextValue); else element.value = nextValue;
      }
      dispatchChange(element);
    } catch { return false; }
    const accepted = fieldValue(element);
    const keys = fieldIdentityKeys(element);
    if (accepted.trim()) {
      const normalized = normalizeTrackedValue(element, accepted);
      filledValues.set(element, accepted);
      for (const key of keys) filledIdentities.set(key, normalized);
    }
    return true;
  }

  function optionLabel(option) {
    return `${option.text || ""} ${option.value || ""}`.trim().toLowerCase();
  }

  function isPlaceholderOption(option) {
    return !option.value || /^(select|choose|please select|--|\s*)$/i.test(optionLabel(option));
  }

  function fillSelectElement(element) {
    if (!canFill(element) || element.disabled || element.multiple || !(element instanceof HTMLSelectElement)) return false;
    const options = Array.from(element.options).filter((option) => !option.disabled && !isPlaceholderOption(option));
    const option = options.find((item) => item.selected) || options[0];
    if (!option) return false;
    return setValue(element, option.value, "message");
  }

  function fillMultiSelectElement(element) {
    if (!canFill(element) || element.disabled || !element.multiple || !(element instanceof HTMLSelectElement)) return false;
    const options = Array.from(element.options).filter((option) => !option.disabled && !isPlaceholderOption(option));
    if (!options.length) return false;
    const picks = options.slice(0, Math.min(2, options.length));
    for (const option of picks) option.selected = true;
    filledValues.set(element, fieldValue(element));
    dispatchChange(element);
    return true;
  }

  function fillCheckboxesAndRadios(candidates) {
    const filled = [];
    const radioGroups = new Set();
    for (const element of candidates) {
      if (!(element instanceof HTMLInputElement) || !eligible(element) || !canFill(element)) continue;
      const type = (element.type || "").toLowerCase();
      if (type === "checkbox" && !element.checked) {
        element.checked = true;
        filled.push("checkbox");
        dispatchChange(element);
      }
      if (type === "radio" && !element.checked) {
        const group = `${element.name || element.id || element.value || "radio"}`;
        if (radioGroups.has(group)) continue;
        element.checked = true;
        radioGroups.add(group);
        filled.push("radio");
        dispatchChange(element);
      }
    }
    return filled;
  }

  function fillTextFallbackField(element, profile) {
    if (!element || element.disabled || element.readOnly || !visible(element) || fieldValue(element).trim()) return false;
    const type = (element.type || "").toLowerCase();
    const role = (element.getAttribute && element.getAttribute("role")) || "";
    if (element instanceof HTMLTextAreaElement || element.isContentEditable || (element instanceof HTMLInputElement && ["", "text", "search"].includes(type)) || role === "textbox") {
      return setValue(element, profile?.otherText || "Lorem ipsum dolor sit amet, consectetur adipiscing elit.", "message");
    }
    return false;
  }

  function fillContactProfile(profile) {
    const filled = [];
    const touched = new WeakSet();
    const fillPass = () => {
      const candidates = activePopupCandidates();
      let changed = false;
      for (const field of candidates) {
        if (touched.has(field) || !eligible(field) || !canFill(field)) continue;
        if (field instanceof HTMLSelectElement) continue;
        const before = fieldValue(field);
        const didFill = fillSafeField(field, profile) || fillUnknownSafeField(field, profile) || fillRemainingSafeField(field, profile);
        if (didFill && fieldValue(field) !== before) { touched.add(field); filled.push(classifyField(field) || fallbackKey(field)); changed = true; }
      }
      for (const field of candidates) {
        if (touched.has(field) || !eligible(field) || !canFill(field) || !(field instanceof HTMLSelectElement)) continue;
        const before = fieldValue(field);
        const didFill = fillSelectElement(field) || fillMultiSelectElement(field);
        if (didFill && fieldValue(field) !== before) { touched.add(field); filled.push(field.multiple ? "multi-select" : "select"); changed = true; }
      }
      const custom = fillCustomControls(candidates);
      if (custom.length) { filled.push(...custom); changed = true; }
      return changed;
    };
    fillPass();
    fillPass();
    const finalCandidates = activePopupCandidates();
    for (const field of finalCandidates) {
      if (fillTextFallbackField(field, profile)) filled.push("text-fallback");
    }
    return filled.length
      ? { ok: true, message: `Filled ${filled.length} safe contact field${filled.length === 1 ? "" : "s"}.`, filled }
      : { ok: false, message: "No empty safe contact fields were found on this page.", filled };
  }

  async function copyEmail(email) {
    try { await navigator.clipboard.writeText(email); return { ok: true, message: "Copied to clipboard." }; }
    catch { return { ok: false, message: "Copy failed. Select the email in the extension and copy it manually." }; }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "FILL_CONTACT_PROFILE") { sendResponse(fillContactProfile(message.profile)); return; }
    if (message.type === "COPY_EMAIL") { copyEmail(message.email).then(sendResponse); return true; }
  });
})();
