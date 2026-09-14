const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const vm = require("vm");
const crypto = require("crypto").webcrypto;
const context = { crypto, URL };
context.globalThis = context;
vm.createContext(context);
["src/shared/constants.js", "src/shared/generator.js"].forEach((file) => vm.runInContext(fs.readFileSync(file, "utf8"), context));
const { WebPlover } = context;
const assert = (condition, label) => { if (!condition) throw new Error(label); };

(async () => {
  assert(!manifest.action.default_popup, "toolbar click does not open a popup");
  assert(WebPlover.buildEmail({ department: "qa", mode: "sequential", counter: 1, domain: "webplover.com" }) === "qa-000001@webplover.com", "sequential email");
  assert(WebPlover.buildEmail({ department: "dev", mode: "sequential", counter: 12, domain: "webplover.com" }) === "dev-000012@webplover.com", "department email");
  assert(WebPlover.buildEmail({ aliasPrefix: "sales", department: "qa", mode: "sequential", counter: 12, domain: "webplover.com" }) === "sales-000012@webplover.com", "custom alias prefix");
  assert(WebPlover.buildEmail({ department: "qa", mode: "website", counter: 12, domain: "webplover.com", pageUrl: "https://www.example.com/contact" }) === "example-qa-012@webplover.com", "website email");
  assert(WebPlover.buildEmail({ department: "qa", mode: "website", counter: 12, domain: "webplover.com", website: "client.example" }) === "client-qa-012@webplover.com", "configured website email");
  assert(WebPlover.normalizeWebsite("example.com") === "example.com", "website normalization");
  assert(WebPlover.normalizeCountry("ca") === "CA", "country normalization");
  assert(WebPlover.normalizeDomain("") === "example.com", "default domain");
  const profileA = WebPlover.contactProfile({ email: "qa-000001@webplover.com", allocationId: "allocation-1", country: "US" });
  const profileB = WebPlover.contactProfile({ email: "qa-000001@webplover.com", allocationId: "allocation-1", country: "US" });
  assert(JSON.stringify(profileA) === JSON.stringify(profileB), "deterministic profile");
  assert(profileA.email === "qa-000001@webplover.com" && /^[A-Za-z]+ [A-Za-z]+$/.test(profileA.fullName), "safe contact profile");
  assert(WebPlover.contactProfile({ email: "qa-000001@webplover.com", company: "Acme Ltd" }).company === "Acme Ltd", "custom company profile");
  assert(WebPlover.contactProfile({ email: "qa-000001@webplover.com", namePrefix: "Dr.", nameSuffix: "Jr." }).fullName.startsWith("Dr. ") && WebPlover.contactProfile({ email: "qa-000001@webplover.com", namePrefix: "Dr.", nameSuffix: "Jr." }).fullName.endsWith(" Jr."), "name prefix and suffix");
  const prefixedProfile = WebPlover.contactProfile({ email: "qa-000001@webplover.com", allocationId: "prefixed-profile", otherPrefix: "Hello", otherSuffix: "Thanks" });
  assert(prefixedProfile.otherText.startsWith("Hello ") && prefixedProfile.otherText.endsWith(". Thanks"), "other text prefix and suffix");
  const loremA = WebPlover.contactProfile({ email: "qa-000001@webplover.com", allocationId: "qa-1" }).otherText;
  const loremB = WebPlover.contactProfile({ email: "qa-000002@webplover.com", allocationId: "qa-2" }).otherText;
  assert(loremA !== loremB && loremA.split(" ").length >= 10 && loremB.split(" ").length <= 30, "varied lorem text");
  assert(/^\+1 555-\d{4}$/.test(profileA.phone), "fictional phone format");
  assert(WebPlover.contactProfile({ email: "qa-000002@webplover.com", allocationId: "allocation-ca", country: "CA" }).stateRegion === "ON", "Canadian profile");
  assert(WebPlover.contactProfile({ email: "qa-000003@webplover.com", allocationId: "allocation-gb", country: "GB" }).country === "GB", "UK profile");
  assert(/^\+92 3\d{9}$/.test(WebPlover.contactProfile({ email: "qa-000004@webplover.com", allocationId: "allocation-pk", country: "PK" }).phone), "Pakistani phone format");
  assert(/^\+91 [6-9]\d{9}$/.test(WebPlover.contactProfile({ email: "qa-000005@webplover.com", allocationId: "allocation-in", country: "IN" }).phone), "Indian phone format");
  assert(WebPlover.csvCell('a,"b"') === '"a,""b"""', "CSV escaping");

  class FakeInput {
    constructor(name, type = "text") { this.name = name; this.type = type; this.value = ""; this.labels = []; this.disabled = false; this.readOnly = false; }
    getAttribute(name) { return name === "autocomplete" ? "" : name === "aria-label" ? "" : null; }
    getBoundingClientRect() { return { width: 1, height: 1 }; }
    dispatchEvent() {}
  }
  class FakeTextArea extends FakeInput {}
  class FakeContentEditableInput extends FakeInput { constructor(name, type) { super(name, type); this.isContentEditable = true; this.textContent = ""; } }
  const firstNameField = new FakeInput("txtFirstName"); firstNameField.placeholder = "Your First Name";
  const lastNameField = new FakeInput("txtLastName"); lastNameField.placeholder = "Your Last Name";
  const mobileField = new FakeInput("txtMobile"); mobileField.placeholder = "Your Mobile";
  const emailField = new FakeInput("email", "email");
  const loremField = new FakeTextArea("message");
  const contentEditableDate = new FakeContentEditableInput("date", "date");
  const dateField = new FakeInput("full_name", "date");
  const unknownField = new FakeInput("custom_field");
  const fields = [firstNameField, lastNameField, mobileField, emailField, loremField, contentEditableDate, dateField, unknownField];
  let fillListener;
  const fillContext = {
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: FakeTextArea,
    HTMLSelectElement: class FakeSelect extends FakeInput {},
    Event: class Event { constructor(type) { this.type = type; } },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    document: { activeElement: null, querySelectorAll: (selector) => selector === "input, textarea, select, [contenteditable=\"true\"]" ? fields : [] },
    chrome: { runtime: { onMessage: { addListener: (listener) => { fillListener = listener; } } } }
  };
  class FakeButton {
    constructor(label, attrs = {}) { this.clicked = false; this.disabled = false; this.readOnly = false; this._attrs = attrs; this.textContent = label; this.ownerDocument = null; this.style = { zIndex: 0 }; }
    getAttribute(name) { return this._attrs[name] ?? null; }
    getBoundingClientRect() { return { width: 1, height: 1 }; }
  querySelectorAll() { return []; }
  closest() { return null; }
  click() { this.clicked = true; }

  }
  class FakeListbox extends FakeButton {
    querySelectorAll(selector) { return selector.includes("[role=option]") ? this.options : []; }
  closest() { return null; }
  }
  vm.createContext(fillContext);
  vm.runInContext(fs.readFileSync("src/content/content-script.js", "utf8"), fillContext);
  const normalized = fillContext.WebPloverFieldSignals;
  const normalizationCases = {
    first_name: ["first name", "firstname"],
    "first-name": ["first name", "firstname"],
    firstName: ["first name", "firstname"],
    FirstName: ["first name", "firstname"],
    FIRST_NAME: ["first name", "firstname"],
    customerName: ["customer name", "customername"],
    contact_name: ["contact name", "contactname"],
    txtFirstName: ["txt first name", "txtfirstname"],
    emailAddress: ["email address", "emailaddress"],
    mobile_number: ["mobile number", "mobilenumber"],
    addressLine1: ["address line 1", "addressline1"],
    postal_code: ["postal code", "postalcode"],
    jobTitle: ["job title", "jobtitle"],
    companyName: ["company name", "companyname"]
  };
  Object.entries(normalizationCases).forEach(([input, [tokens, compact]]) => {
    assert(normalized.normalizeFieldText(input) === tokens && normalized.compactFieldText(input) === compact, `field normalization: ${input}`);
  });
  const normalizedSignals = normalized.normalizeFieldSignals({ name: "firstName", label: "First Name", nearbyText: "Customer Details" });
  assert(normalizedSignals.raw.name === "firstName" && normalizedSignals.tokens.name === "first name" && normalizedSignals.compact.label === "firstname" && normalizedSignals.tokens.nearbyText === "customer details" && normalizedSignals.compact.nearbyText === "customerdetails" && !normalizedSignals.tokens.label.includes("customer"), "structured normalized signals");
  const aliasCases = { firstName: "firstName", first_name: "firstName", givenName: "firstName", surname: "lastName", customerName: "fullName", contact_name: "fullName", emailAddress: "email", confirmEmail: "confirmEmail", mobileNumber: "phone", contact_number: "phone", companyName: "company", jobTitle: "jobTitle", addressLine1: "address1", addressLine2: "address2", postalCode: "postalCode", zipCode: "postalCode", passportNumber: "passport", nationalId: "nationalId", employeeId: "employeeId", quantity: "quantity", price: "price", confirmPassword: "confirmPassword" };
  Object.entries(aliasCases).forEach(([input, expected]) => assert(normalized.findAliasMatches(normalized.normalizeFieldText(input)).includes(expected), `field alias: ${input}`));
  const exactAliasCases = {
    confirmEmail: ["confirmEmail"], confirm_email: ["confirmEmail"], repeatEmail: ["confirmEmail"], reenterEmail: ["confirmEmail"], retypeEmail: ["confirmEmail"], verifyEmail: ["confirmEmail"], email: ["email"], emailAddress: ["email"],
    confirmPassword: ["confirmPassword"], confirm_password: ["confirmPassword"], repeatPassword: ["confirmPassword"], reenterPassword: ["confirmPassword"], retypePassword: ["confirmPassword"], verifyPassword: ["confirmPassword"], password: ["password"], passwd: ["password"],
    firstName: ["firstName"], lastName: ["lastName"], fullName: ["fullName"], customerName: ["fullName"], companyName: ["company"], username: ["username"], postalCode: ["postalCode"], passportNumber: ["passport"]
  };
  Object.entries(exactAliasCases).forEach(([input, expected]) => assert(JSON.stringify(normalized.findAliasMatches(normalized.normalizeFieldText(input))) === JSON.stringify(expected), `exact field alias: ${input}`));
  ["firstname", "lastname", "username", "companyname", "filename", "hostname", "numberplate", "update", "statement", "countrycode"].forEach((input) => assert(!normalized.findAliasMatches(normalized.normalizeFieldText(input)).includes("fullName"), `field alias false positive: ${input}`));
  assert(!normalized.findAliasMatches("numberplate").includes("number"), "number alias boundary");
  assert(!normalized.findAliasMatches("update").includes("date"), "date alias boundary");
  assert(!normalized.findAliasMatches("statement").includes("state"), "state alias boundary");
  assert(!normalized.findAliasMatches("country code").includes("postalCode"), "country code alias boundary");
  const classify = (signals) => normalized.classifyNormalizedFieldSignals(normalized.normalizeFieldSignals(signals));
  const classificationCases = { firstName: [{ name: "first_name" }, "firstName"], fullName: [{ name: "customerName" }, "fullName"], email: [{ name: "emailAddress" }, "email"], phone: [{ name: "mobileNumber" }, "phone"], company: [{ name: "companyName" }, "company"], postalCode: [{ type: "number", name: "postalCode" }, "postalCode"], price: [{ type: "number", name: "price" }, "price"], quantity: [{ type: "number", name: "quantity" }, "quantity"], age: [{ type: "number", name: "age" }, "age"], percentage: [{ type: "number", name: "percentage" }, "percentage"], number: [{ type: "number", name: "randomField" }, "number"], typeEmail: [{ type: "email", name: "random" }, "email"] };
  const contextualCases = { userFirstName: "firstName", customerFirstName: "firstName", applicantFirstName: "firstName", userLastName: "lastName", customerLastName: "lastName", billingEmail: "email", workEmail: "email", contactEmail: "email", companyEmail: "email", primaryEmail: "email", homePhone: "phone", workPhone: "phone", officePhone: "phone", customerPhone: "phone", companyPhone: "phone", billingAddressLine1: "address1", shippingAddressLine1: "address1", billingCity: "city", shippingCity: "city", billingState: "state", shippingState: "state", billingPostalCode: "postalCode", shippingZipCode: "postalCode", billingCountry: "country", shippingCountry: "country", userFullName: "fullName", profileName: "fullName", displayName: "fullName", userid: "username", websiteUrl: "website", companyWebsite: "website", personalWebsite: "website", homepage: "website", occupation: "jobTitle", profession: "jobTitle" };
  Object.entries(classificationCases).forEach(([label, [signals, expected]]) => assert(classify(signals).type === expected, `semantic classification: ${label}`));
  Object.entries(contextualCases).forEach(([name, expected]) => assert(classify({ name }).type === expected, `contextual classification: ${name}`));
  ["filename", "hostname", "numberPlate", "statement", "update"].forEach((name) => assert(classify({ name }).type === null, `contextual false positive: ${name}`));
  assert(classify({ type: "number", name: "phone" }).type === "number" && classify({ type: "number", name: "mobileNumber" }).type === "number" && classify({ type: "number", name: "randomField" }).type === "number" && classify({ type: "number", name: "postalCode" }).type === "postalCode" && classify({ type: "number", name: "price" }).type === "price" && classify({ type: "number", name: "quantity" }).type === "quantity", "number type precedence");
  const autocompleteCases = { "given-name": "firstName", "family-name": "lastName", name: "fullName", email: "email", tel: "phone", "tel-national": "phone", "tel-local": "phone", "tel-country-code": "phone", organization: "company", "organization-title": "jobTitle", "street-address": "address1", "address-line1": "address1", "address-line2": "address2", "address-level2": "city", "address-level1": "state", country: "country", "country-name": "country", "postal-code": "postalCode", url: "website", username: "username", "current-password": "password", "new-password": "password" };
  Object.entries(autocompleteCases).forEach(([input, expected]) => assert(classify({ autocomplete: input }).type === expected, `autocomplete classification: ${input}`));
  const multiAutocompleteCases = { "section-checkout shipping given-name": "firstName", "billing postal-code": "postalCode", "section-user home tel-national": "phone", "shipping address-line1": "address1", "section-profile organization-title": "jobTitle" };
  Object.entries(multiAutocompleteCases).forEach(([input, expected]) => assert(classify({ autocomplete: input }).type === expected, `multi-token autocomplete: ${input}`));
  const confirmCases = { confirmEmail: [{ type: "email", name: "confirmEmail" }, "confirmEmail"], confirm_email: [{ type: "email", name: "confirm_email" }, "confirmEmail"], repeatEmail: [{ type: "email", name: "repeatEmail" }, "confirmEmail"], "Confirm Email": [{ type: "email", label: "Confirm Email" }, "confirmEmail"], repeatPassword: [{ type: "password", name: "repeatPassword" }, "confirmPassword"], confirmPassword: [{ type: "password", name: "confirmPassword" }, "confirmPassword"], "Confirm Password": [{ type: "password", label: "Confirm Password" }, "confirmPassword" ] };
  Object.entries(confirmCases).forEach(([label, [signals, expected]]) => assert(classify(signals).type === expected, `confirm specialization: ${label}`));
  assert(classify({ type: "email", name: "phone" }).type === "email" && classify({ type: "email", className: "phone", nearbyText: "Phone" }).type === "email" && classify({ type: "password", name: "username" }).type === "password", "HTML type conflict safety");
  ["filename", "hostname", "statement", "update", "numberplate"].forEach((name) => assert(classify({ name }).type === null, `semantic classification false positive: ${name}`));
  assert(classify({ className: "email" }).type === null && classify({ nearbyText: "Phone Number" }).type === null, "weak signals do not classify");
  assert(classify({ name: "customer_name", className: "email-field" }).type === "fullName" && classify({ type: "email", className: "phone" }).type === "email", "semantic signal conflict");
  const policyField = (signals) => ({ ...signals, type: signals.type || "text", disabled: false, readOnly: false, getAttribute: (name) => signals[name] || "", labels: signals.label ? [{ textContent: signals.label }] : [], getBoundingClientRect: () => ({ width: 1, height: 1 }) });
  const allowedIdentifiers = ["passportNumber", "passport_number", "nationalId", "cnic", "employeeId", "taxId", "accountNumber", "username"];
  allowedIdentifiers.forEach((name) => assert(!normalized.protectedFieldReason(policyField({ name })), `allowed identifier policy: ${name}`));
  ["Passport Number", "National ID", "Employee ID"].forEach((label) => assert(!normalized.protectedFieldReason(policyField({ label })), `allowed label policy: ${label}`));
  ["otp", "captcha", "recaptcha_response", "cardNumber", "cvv", "cvc", "iban", "routingNumber", "swift", "ssn"].forEach((name) => assert(normalized.protectedFieldReason(policyField({ name })), `protected policy: ${name}`));
  ["OTP Code", "One-Time Code", "Verification Code", "Credit Card Number", "Bank Account Number", "Social Security Number"].forEach((label) => assert(normalized.protectedFieldReason(policyField({ label })), `protected label policy: ${label}`));
  assert(normalized.protectedFieldReason(policyField({ autocomplete: "one-time-code" })) === "otp" && normalized.protectedFieldReason(policyField({ autocomplete: "cc-number" })) === "payment-card", "protected autocomplete policy");
  ["Verify Email", "Email Verification"].forEach((label) => assert(!normalized.protectedFieldReason(policyField({ label })), `verification false positive: ${label}`));
  assert(!normalized.protectedFieldReason(policyField({ name: "customerName", nearbyText: "Bank Details" })) && !normalized.protectedFieldReason(policyField({ name: "accountNumber" })) && normalized.protectedFieldReason(policyField({ label: "Bank Account Number" })), "context-sensitive banking policy");
  const fill = (profile) => { let result; fillListener({ type: "FILL_CONTACT_PROFILE", profile }, null, (response) => { result = response; }); return result; };
  const firstProfile = { ...WebPlover.contactProfile({ email: "first@example.com", allocationId: "first", namePrefix: "Alpha", nameSuffix: "One" }), firstName: "Alpha First", lastName: "One Last", fullName: "Alpha First One Last", otherText: "First lorem" };
  const secondProfile = { ...WebPlover.contactProfile({ email: "second@example.com", allocationId: "second", namePrefix: "Beta", nameSuffix: "Two" }), firstName: "Beta First", lastName: "Two Last", fullName: "Beta First Two Last", otherText: "Second lorem" };
  fill(firstProfile);
  const firstFilledValues = { firstName: firstNameField.value, lastName: lastNameField.value, phone: mobileField.value, email: emailField.value, lorem: loremField.value, unknown: unknownField.value };
  fill(secondProfile);
  assert(firstNameField.value === secondProfile.firstName && lastNameField.value === secondProfile.lastName && mobileField.value === secondProfile.phone && emailField.value === secondProfile.email && loremField.value === secondProfile.otherText && unknownField.value === secondProfile.otherText, "refreshes Plover-filled fields on repeat autofill");
  emailField.value = "person@example.com";
  fill({ email: "third@example.com", otherText: "Third lorem" });
  assert(emailField.value === "person@example.com" && loremField.value === "Third lorem", "preserves user-edited fields");

  class ComplexInput extends FakeInput {
    constructor(name, type = "text") { super(name, type); this.labels = []; this.placeholder = ""; this._attrs = {}; }
    getAttribute(name) { return this._attrs[name] ?? null; }
    setAttribute(name, value) { this._attrs[name] = String(value); }
  }
  class ComplexTextArea extends FakeTextArea {
    constructor(name) { super(name); this.labels = []; this.placeholder = ""; this._attrs = {}; }
    getAttribute(name) { return this._attrs[name] ?? null; }
    setAttribute(name, value) { this._attrs[name] = String(value); }
  }
  class ComplexSelect extends FakeInput {
    constructor(name) { super(name, "select-one"); this.options = []; this.multiple = false; }
    getAttribute(name) { return this._attrs?.[name] ?? null; }
  }
  const makeField = (label, type = "text", attrs = {}) => { const field = type === "textarea" ? new ComplexTextArea(label) : type === "select" ? new ComplexSelect(label) : new ComplexInput(label, type); field.labels = [{ textContent: label }]; field.placeholder = attrs.placeholder || ""; field._attrs = { ...attrs }; field.getBoundingClientRect = () => ({ width: 1, height: 1 }); field.dispatchEvent = () => {}; return field; };
  const complexFields = [
    makeField("First Name"), makeField("Last Name"), makeField("Full Name"), makeField("Email", "email"), makeField("Secondary Email", "email"), makeField("Phone", "tel"), makeField("Alternate Phone", "tel"), makeField("Company"), makeField("Department"), makeField("Address"), makeField("City"), makeField("State"), makeField("Postal Code"), makeField("Country"), makeField("Website", "url"), makeField("Job Title"), makeField("Project Name"), makeField("Product Name"), makeField("Reference Name"), makeField("Business Requirement", "textarea"), makeField("Custom Details"), makeField("Additional Information", "textarea"), makeField("Numeric Custom Field", "number"), makeField("Password", "password"), makeField("Manually Entered Value")
  ];
  complexFields[24].value = "keep me";
  const complexProfile = { ...WebPlover.contactProfile({ email: "qa-000009@webplover.com", allocationId: "complex", country: "US" }), department: "Support", otherText: "Lorem ipsum dolor sit amet" };
  let complexListener;
  const complexContext = {
    HTMLInputElement: ComplexInput,
    HTMLTextAreaElement: ComplexTextArea,
    HTMLSelectElement: ComplexSelect,
    Event: class Event { constructor(type) { this.type = type; } },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    document: { activeElement: null, querySelectorAll: (selector) => selector === "input, textarea, select, [contenteditable=\"true\"]" ? complexFields : [] },
    chrome: { runtime: { onMessage: { addListener: (listener) => { complexListener = listener; } } } }
  };
  vm.createContext(complexContext);
  vm.runInContext(fs.readFileSync("src/content/content-script.js", "utf8"), complexContext);
  complexListener({ type: "FILL_CONTACT_PROFILE", profile: complexProfile }, null, () => {});
  assert(complexFields[0].value === complexProfile.firstName, "fills first name");
  assert(complexFields[1].value === complexProfile.lastName, "fills last name");
  assert(complexFields[2].value === complexProfile.fullName, "fills full name");
  assert(complexFields[3].value === complexProfile.email, "fills email");
  assert(complexFields[4].value === complexProfile.email, "fills secondary email fallback");
  assert(complexFields[5].value === complexProfile.phone, "fills phone");
  assert(complexFields[6].value === complexProfile.phone, "fills alternate phone fallback");
  assert(complexFields[7].value === complexProfile.company, "fills company");
  assert(complexFields[8].value === complexProfile.department, "fills department");
  assert(complexFields[9].value === complexProfile.address1, "fills address");
  assert(complexFields[10].value === complexProfile.city, "fills city");
  assert(complexFields[11].value === complexProfile.stateRegion, "fills state");
  assert(complexFields[12].value === complexProfile.postalCode, "fills postal code");
  assert(complexFields[13].value === complexProfile.country, "fills country");
  assert(complexFields[14].value === complexProfile.website, "fills website");
  assert(complexFields[15].value === complexProfile.jobTitle, "fills job title");
  assert(complexFields[16].value === complexProfile.otherText, "fills project name fallback");
  assert(complexFields[17].value === complexProfile.otherText, "fills product name fallback");
  assert(complexFields[18].value === complexProfile.otherText, "fills reference name fallback");
  assert(complexFields[19].value === complexProfile.otherText, "fills business requirement fallback");
  assert(complexFields[20].value === complexProfile.otherText, "fills custom details fallback");
  assert(complexFields[21].value === complexProfile.otherText, "fills additional information fallback");
  assert(complexFields[22].value === "42", "fills numeric custom field");
  assert(complexFields[23].value === "", "leaves password untouched");
  assert(complexFields[24].value === "keep me", "preserves manually entered value");

  const rerenderFields = [
    makeField("Name", "text"),
    makeField("Email", "email"),
    makeField("Phone", "tel"),
    makeField("Department", "text"),
    makeField("Project Name", "text"),
    makeField("Custom Details", "text")
  ];
  let rerenderListener;
  const rerenderContext = {
    HTMLInputElement: ComplexInput,
    HTMLTextAreaElement: ComplexTextArea,
    HTMLSelectElement: ComplexSelect,
    Event: class Event { constructor(type) { this.type = type; } },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    document: { activeElement: null, querySelectorAll: (selector) => selector === "input, textarea, select, [contenteditable=\"true\"]" ? rerenderFields : [] },
    chrome: { runtime: { onMessage: { addListener: (listener) => { rerenderListener = listener; } } } }
  };
  vm.createContext(rerenderContext);
  vm.runInContext(fs.readFileSync("src/content/content-script.js", "utf8"), rerenderContext);
  const firstRerenderProfile = { ...WebPlover.contactProfile({ email: "first-refresh@example.com", allocationId: "refresh-1" }), otherText: "First refresh lorem" };
  const secondRerenderProfile = { ...WebPlover.contactProfile({ email: "second-refresh@example.com", allocationId: "refresh-2" }), otherText: "Second refresh lorem" };
  rerenderListener({ type: "FILL_CONTACT_PROFILE", profile: firstRerenderProfile }, null, () => {});
  const firstValues = rerenderFields.map((field) => field.value);
  rerenderFields[4].value = "My Real Project";
  const replacedEmail = new ComplexInput("EMAIL", "email");
  replacedEmail.labels = [{ textContent: "Email" }];
  replacedEmail._attrs = { "data-slug": "primary-email" };
  replacedEmail.value = firstValues[1];
  replacedEmail.getBoundingClientRect = () => ({ width: 1, height: 1 });
  replacedEmail.dispatchEvent = () => {};
  rerenderFields[1] = replacedEmail;
  rerenderListener({ type: "FILL_CONTACT_PROFILE", profile: secondRerenderProfile }, null, () => {});
  assert(rerenderFields[0].value === secondRerenderProfile.fullName, "refreshes name on second autofill");
  assert(rerenderFields[1].value === secondRerenderProfile.email, "refreshes recreated email field");
  assert(rerenderFields[2].value === secondRerenderProfile.phone, "refreshes phone on second autofill");
  assert(rerenderFields[3].value === secondRerenderProfile.department, "refreshes department on second autofill");
  assert(rerenderFields[4].value === "My Real Project", "preserves user-edited field");
  assert(rerenderFields[5].value === secondRerenderProfile.otherText, "refreshes fallback text field");

  const fallbackFields = [
    makeField("Mystery Field", "text", { inputmode: "text" }),
    makeField("Decimal Amount", "number", { min: "1.5", max: "9.5", step: "0.5" }),
    makeField("Age", "number", { min: "18", max: "99" }),
    makeField("Quantity", "number", { min: "1", max: "10" }),
    makeField("Percentage", "number", { min: "0", max: "100" }),
    makeField("Postal Code Numeric", "number", { min: "10000", max: "99999" }),
    makeField("Textarea Unknown", "textarea"),
    makeField("URL-ish", "url"),
    makeField("Tel-ish", "tel"),
    makeField("Pattern Numeric", "text", { pattern: "\\d+", inputmode: "numeric" }),
    makeField("Manual Value", "text")
  ];
  fallbackFields[10].value = "already here";
  const fallbackContext = {
    HTMLInputElement: ComplexInput,
    HTMLTextAreaElement: ComplexTextArea,
    HTMLSelectElement: ComplexSelect,
    Event: class Event { constructor(type) { this.type = type; } },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    document: { activeElement: null, querySelectorAll: (selector) => selector === "input, textarea, select, [contenteditable=\"true\"]" ? fallbackFields : [] },
    chrome: { runtime: { onMessage: { addListener: (listener) => { fallbackContext.listener = listener; } } } }
  };
  vm.createContext(fallbackContext);
  vm.runInContext(fs.readFileSync("src/content/content-script.js", "utf8"), fallbackContext);
  fallbackContext.listener({ type: "FILL_CONTACT_PROFILE", profile: { ...WebPlover.contactProfile({ email: "fallback@example.com" }), otherText: "Lorem ipsum dolor sit amet" } }, null, () => {});
  assert(fallbackFields[0].value.length > 0, "fills mystery field");
  assert(Number(fallbackFields[1].value) >= 1.5 && Number(fallbackFields[1].value) <= 9.5, "fills decimal within range");
  assert(Number(fallbackFields[2].value) >= 18 && Number(fallbackFields[2].value) <= 99, "fills age within range");
  assert(Number(fallbackFields[3].value) >= 1 && Number(fallbackFields[3].value) <= 10, "fills quantity within range");
  assert(Number(fallbackFields[4].value) >= 0 && Number(fallbackFields[4].value) <= 100, "fills percentage within range");
  assert(Number(fallbackFields[5].value) >= 10000 && Number(fallbackFields[5].value) <= 99999, "fills postal numeric within range");
  assert(fallbackFields[6].value.length > 0, "fills unknown textarea");
  assert(fallbackFields[7].value.length > 0, "fills url field");
  assert(fallbackFields[8].value.length > 0, "fills tel field");
  assert(fallbackFields[9].value.length > 0, "fills pattern numeric field");
  assert(fallbackFields[10].value === "already here", "preserves filled manual field");

  const normalButton = new FakeButton("Contact form owner", { role: "button" });
  const dropdownOption = new FakeButton("Choose one", { role: "option" });
  const dropdown = new FakeListbox("Select an option", { role: "button", "aria-haspopup": "listbox", "aria-controls": "dropdown-1" });
  const dropdownMenu = new FakeListbox("", { role: "listbox" });
  dropdown.ownerDocument = { getElementById: (id) => id === "dropdown-1" ? dropdownMenu : null };
  dropdownMenu.options = [dropdownOption];
  dropdownMenu.querySelectorAll = (selector) => selector.includes("[role=option]") ? dropdownMenu.options : [];
  dropdown.querySelectorAll = (selector) => selector.includes("[role=option]") ? dropdownMenu.options : [];
  let buttonClicked = false;
  normalButton.click = () => { buttonClicked = true; };
  const customCandidates = [normalButton, dropdown];
  const popupRoot = { style: { zIndex: 1 }, getBoundingClientRect: () => ({ width: 1, height: 1 }), querySelectorAll: (selector) => selector === "*" ? customCandidates : [] };
  const customContext = {
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: FakeTextArea,
    HTMLSelectElement: class FakeSelect extends FakeInput {},
    Event: class Event { constructor(type) { this.type = type; } },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    HTMLElement: FakeButton,
    document: { activeElement: null, querySelectorAll: (selector) => selector === "input, textarea, select, [contenteditable=\"true\"]" ? [] : (selector.includes("[role=dialog]") ? [popupRoot] : customCandidates) },
    chrome: { runtime: { onMessage: { addListener: (listener) => { customContext.listener = listener; } } } }
  };
  vm.createContext(customContext);
  vm.runInContext(fs.readFileSync("src/content/content-script.js", "utf8"), customContext);
  customContext.listener({ type: "FILL_CONTACT_PROFILE", profile: { otherText: "x" } }, null, () => {});
  assert(!buttonClicked, "does not click normal role=button controls");

  const backgroundSource = fs.readFileSync("src/background/service-worker.js", "utf8");
  const backgroundCalls = { sendMessage: [], executeScript: [] };
  const makeTab = (url = "https://example.com/form") => ({ id: 7, url });
  const runBackground = (overrides = {}) => {
    let listener;
    const chromeMock = {
      scripting: { executeScript: async (args) => { backgroundCalls.executeScript.push(args); if (overrides.executeScript) return overrides.executeScript(args); return {}; } },
      tabs: {
        query: async () => [overrides.tab || makeTab()],
        sendMessage: async (tabId, message) => { backgroundCalls.sendMessage.push({ tabId, message }); if (overrides.sendMessage) return overrides.sendMessage(tabId, message, backgroundCalls.sendMessage.length); return { ok: true, message: "filled" }; }
      },
      storage: { local: { get: async () => (overrides.get || {}), set: async () => {} } },
      contextMenus: { removeAll: (_, cb) => cb && cb(), create: () => {}, onClicked: { addListener: () => {} } },
      runtime: { onInstalled: { addListener: () => {} }, onStartup: { addListener: () => {} }, onMessage: { addListener: (fn) => { listener = fn; } }, openOptionsPage: () => {} },
      action: { onClicked: { addListener: () => {} } },
      commands: { onCommand: { addListener: () => {} } }
    };
    const ctx = { console, URL, crypto: { randomUUID: () => "id" }, chrome: chromeMock, importScripts: () => {}, globalThis: null };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync("src/shared/constants.js", "utf8"), ctx);
    vm.runInContext(fs.readFileSync("src/shared/generator.js", "utf8"), ctx);
    vm.runInContext(fs.readFileSync("src/shared/storage.js", "utf8"), ctx);
    vm.runInContext(backgroundSource, ctx);
    return { listener };
  };

  let { listener: bgListener } = runBackground();
  const callBackground = async (...args) => new Promise((resolve) => { bgListener(...args, resolve); });
  let result = await callBackground({ type: "FILL_ACTIVE_TAB", email: "a@b.com" }, { tab: makeTab() });
  assert(result.ok, "content script already available");
  assert(backgroundCalls.executeScript.length === 0, "does not inject when receiver exists");

  backgroundCalls.sendMessage = []; backgroundCalls.executeScript = [];
  ({ listener: bgListener } = runBackground({ sendMessage: async (_tabId, _message, callCount) => callCount === 1 ? Promise.reject(new Error("Could not establish connection. Receiving end does not exist.")) : { ok: true, message: "filled" }, executeScript: async () => ({}) }));
  result = await new Promise((resolve) => { bgListener({ type: "FILL_ACTIVE_TAB", email: "a@b.com" }, { tab: makeTab() }, resolve); });
  assert(result.ok, "no receiver, injection, then retry");
  assert(backgroundCalls.executeScript.length === 1, "injects once after missing receiver");
  assert(backgroundCalls.sendMessage.length === 2, "retries once after injection");

  ({ listener: bgListener } = runBackground({ sendMessage: async () => { throw new Error("Could not establish connection. Receiving end does not exist."); }, executeScript: async () => { throw new Error("Cannot access contents of url"); } }));
  result = await new Promise((resolve) => { bgListener({ type: "FILL_ACTIVE_TAB", email: "a@b.com" }, { tab: { id: 7, url: "chrome://extensions" } }, resolve); });
  assert(!result.ok, "restricted page injection fails");

  ({ listener: bgListener } = runBackground({ sendMessage: async () => { throw new Error("Could not establish connection. Receiving end does not exist."); }, executeScript: async () => ({}) }));
  result = await new Promise((resolve) => { bgListener({ type: "FILL_ACTIVE_TAB", email: "a@b.com" }, { tab: makeTab() }, resolve); });
  assert(!result.ok, "retry failure returns real failure");

  const duplicateGuard = { installed: 0 };
  const dupContext = {
    HTMLInputElement: FakeInput,
    HTMLTextAreaElement: FakeTextArea,
    HTMLSelectElement: class FakeSelect extends FakeInput {},
    Event: class Event { constructor(type) { this.type = type; } },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    document: { querySelectorAll: () => [] },
    chrome: { runtime: { onMessage: { addListener: (listener) => { duplicateGuard.installed += 1; duplicateGuard.listener = listener; } } } }
  };
  vm.createContext(dupContext);
  vm.runInContext(fs.readFileSync("src/content/content-script.js", "utf8"), dupContext);
  vm.runInContext(fs.readFileSync("src/content/content-script.js", "utf8"), dupContext);
  assert(duplicateGuard.installed === 1, "prevents duplicate listener registration");
  console.log("Generator and refill smoke checks passed.");
})().catch((error) => { console.error(error); process.exit(1); });
