import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [loginHtml, appHtml, registerHtml, registerJs, sessionControls, invitationApi] = await Promise.all([
  readFile(new URL("../app/login.html", import.meta.url), "utf8"),
  readFile(new URL("../app/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/register.html", import.meta.url), "utf8"),
  readFile(new URL("../app/register.js", import.meta.url), "utf8"),
  readFile(new URL("../app/session-controls.js", import.meta.url), "utf8"),
  readFile(new URL("../api/v4/tenant-invitations.js", import.meta.url), "utf8")
]);

assert.doesNotMatch(loginHtml, /href="\/register"/, "the signed-out login page must not advertise member management");
assert.match(appHtml, /id="memberManagementLink"[^>]*href="\/register"[^>]*hidden[^>]*>成员管理</, "the management button must start hidden inside the authenticated workbench");
assert.match(sessionControls, /session\.permission_scopes\?\.MANAGE_MEMBERS[\s\S]*memberManagementLink\.hidden = false/, "the workbench may reveal member management only from the server session scope");
assert.match(registerHtml, /id="tenantInviteForm"[^>]*hidden/, "the invitation form must fail closed before permission verification");
assert.match(registerJs, /fetch\("\/api\/session"/, "the member page must verify the current server session");
assert.match(registerJs, /session\.permission_scopes\?\.MANAGE_MEMBERS/, "the member page must require the server-issued management scope");
assert.match(registerJs, /session\.authenticated === false[\s\S]*window\.location\.replace\("\/login\?next=%2Fregister"\)/, "signed-out users must be sent through login");
assert.match(registerJs, /session\.permission_scopes\?\.MANAGE_MEMBERS[\s\S]*accessGate\?\.setAttribute\("hidden"[\s\S]*form\.hidden = false/, "the form may be revealed only after the Owner scope passes");
assert.match(invitationApi, /requireTenantAccess\(req, \{[\s\S]*permission: TENANT_PERMISSIONS\.MANAGE_MEMBERS/, "the invitation API must independently enforce Owner authorization");

console.log("member management gate test passed");
