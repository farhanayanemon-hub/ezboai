<script lang="ts">
  import type { PageData, ActionData } from "./$types";
  import { enhance } from "$app/forms";
  import * as Card from "$lib/components/ui/card/index.js";
  import * as Button from "$lib/components/ui/button/index.js";
  import * as Input from "$lib/components/ui/input/index.js";
  import * as Label from "$lib/components/ui/label/index.js";
  import * as Select from "$lib/components/ui/select/index.js";
  import { Separator } from "$lib/components/ui/separator/index.js";
  import { Badge } from "$lib/components/ui/badge/index.js";
  import { EyeIcon, EyeOffIcon, MailIcon, FileTextIcon, SettingsIcon, RotateCcwIcon, SaveIcon, EditIcon, XIcon } from "$lib/icons/index.js";
  import { toast } from "svelte-sonner";

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let otpEnabled = $state(data?.otpVerificationEnabled ?? false);
  let otpSaving = $state(false);

  $effect(() => {
    if (form?.otpToggled) {
      toast.success(`OTP verification ${otpEnabled ? 'enabled' : 'disabled'}`);
    }
  });

  let activeTab = $state<'smtp' | 'templates'>('smtp');
  let loading = $state(false);
  let showPassword = $state(false);

  let smtpHost = $state(data?.settings?.smtpHost || "");
  let smtpPort = $state(data?.settings?.smtpPort || "");
  let smtpSecure = $state(data?.settings?.smtpSecure || "false");
  let smtpUser = $state(data?.settings?.smtpUser || "");
  let smtpPass = $state(data?.settings?.smtpPass || "");
  let fromEmail = $state(data?.settings?.fromEmail || "");
  let fromName = $state(data?.settings?.fromName || "");
  let adminNotificationEmail = $state((data?.settings as any)?.adminNotificationEmail || "");

  $effect(() => {
    if (data?.settings && !form) {
      smtpHost = data.settings.smtpHost || "";
      smtpPort = data.settings.smtpPort || "";
      smtpSecure = data.settings.smtpSecure || "false";
      smtpUser = data.settings.smtpUser || "";
      smtpPass = data.settings.smtpPass || "";
      fromEmail = data.settings.fromEmail || "";
      fromName = data.settings.fromName || "";
      adminNotificationEmail = (data.settings as any).adminNotificationEmail || "";
    }
  });

  let showSuccess = $state(false);
  $effect(() => {
    if (form?.success && !form?.templateSaved && !form?.templateReset && !form?.otpToggled) {
      showSuccess = true;
      setTimeout(() => { showSuccess = false; }, 3000);
    }
  });

  let testEmail = $state('');
  let testEmailSending = $state(false);
  let testEmailResult = $state<{ ok: boolean; msg: string } | null>(null);

  async function sendTestEmail() {
    testEmailResult = null;
    testEmailSending = true;
    try {
      const res = await fetch('/api/admin/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toEmail: testEmail }),
      });
      const data = await res.json();
      testEmailResult = { ok: data.success, msg: data.message };
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.error(data.message);
      }
    } catch (e) {
      testEmailResult = { ok: false, msg: 'Request failed. Check your network.' };
      toast.error('Failed to send test email');
    } finally {
      testEmailSending = false;
    }
  }

  const securityOptions = [
    { value: "false", label: "No (STARTTLS)" },
    { value: "true", label: "Yes (SSL/TLS)" },
  ];

  const selectedSecurity = $derived(() => {
    return securityOptions.find((opt) => opt.value === smtpSecure) ?? securityOptions[0];
  });

  let editingTemplate = $state<string | null>(null);
  let editSubject = $state("");
  let editHtml = $state("");
  let defaultSubject = $state("");
  let defaultHtml = $state("");
  let templateLoading = $state(false);
  let savingTemplate = $state(false);

  async function loadTemplateForEdit(templateName: string) {
    templateLoading = true;
    try {
      const res = await fetch(`/api/admin/email-template/${templateName}`);
      if (!res.ok) {
        toast.error('Failed to load template');
        return;
      }
      const td = await res.json();
      editingTemplate = templateName;
      editSubject = td.subject;
      editHtml = td.html;
      defaultSubject = td.defaultSubject;
      defaultHtml = td.defaultHtml;
    } catch (e) {
      toast.error('Failed to load template');
    } finally {
      templateLoading = false;
    }
  }

  function closeEditor() {
    editingTemplate = null;
    editSubject = "";
    editHtml = "";
    defaultSubject = "";
    defaultHtml = "";
  }

  function restoreDefault() {
    editSubject = defaultSubject;
    editHtml = defaultHtml;
  }

  $effect(() => {
    if (form?.templateSaved) {
      toast.success('Template saved successfully');
      closeEditor();
    }
    if (form?.templateReset) {
      toast.success('Template reset to default');
      closeEditor();
    }
    if (form?.templateError) {
      toast.error(form?.error || 'Template operation failed');
    }
  });

  function getEditingLabel(): string {
    const t = data.templates?.find((t: any) => t.name === editingTemplate);
    return t?.label || editingTemplate || '';
  }

  function getEditingVars(): string[] {
    const t = data.templates?.find((t: any) => t.name === editingTemplate);
    return t?.variables || [];
  }
</script>

<svelte:head>
  <title>Mailing Settings - Admin</title>
</svelte:head>

<div class="space-y-4">
  {#if data.isDemoMode}
    <div class="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-md">
      <div class="flex items-center gap-2">
        <div class="flex-shrink-0">
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path>
          </svg>
        </div>
        <div>
          <p class="font-medium">Demo Mode Active</p>
          <p class="text-sm">All modifications are disabled.</p>
        </div>
      </div>
    </div>
  {/if}

  <div>
    <h1 class="text-xl font-semibold tracking-tight flex items-center gap-2">
      <MailIcon class="w-6 h-6" />
      Mailing Settings
    </h1>
    <p class="text-muted-foreground">
      Configure SMTP settings and customize email templates.
    </p>
  </div>

  <Card.Root>
    <Card.Header>
      <Card.Title class="text-base">OTP Email Verification</Card.Title>
      <Card.Description>
        When enabled, new users must verify their email with a one-time code before they can log in.
      </Card.Description>
    </Card.Header>
    <Card.Content>
      <form
        method="POST"
        action="?/toggleOtp"
        use:enhance={() => {
          otpSaving = true;
          return async ({ update }) => {
            await update();
            otpSaving = false;
          };
        }}
      >
        <input type="hidden" name="otpEnabled" value={otpEnabled ? 'true' : 'false'} />
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium">{otpEnabled ? 'Enabled' : 'Disabled'}</span>
              <Badge variant={otpEnabled ? 'default' : 'secondary'}>{otpEnabled ? 'ON' : 'OFF'}</Badge>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <Button.Root
              type="button"
              variant={otpEnabled ? 'outline' : 'default'}
              size="sm"
              disabled={otpSaving || data.isDemoMode}
              onclick={() => { otpEnabled = !otpEnabled; }}
            >
              {otpEnabled ? 'Disable' : 'Enable'}
            </Button.Root>
            <Button.Root type="submit" size="sm" disabled={otpSaving || data.isDemoMode}>
              {otpSaving ? 'Saving...' : 'Save'}
            </Button.Root>
          </div>
        </div>
      </form>
    </Card.Content>
  </Card.Root>

  <div class="flex gap-1 border-b">
    <button
      class="px-4 py-2 text-sm font-medium border-b-2 transition-colors {activeTab === 'smtp' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
      onclick={() => { activeTab = 'smtp'; closeEditor(); }}
    >
      <span class="flex items-center gap-2">
        <SettingsIcon class="w-4 h-4" />
        SMTP Settings
      </span>
    </button>
    <button
      class="px-4 py-2 text-sm font-medium border-b-2 transition-colors {activeTab === 'templates' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
      onclick={() => { activeTab = 'templates'; closeEditor(); }}
    >
      <span class="flex items-center gap-2">
        <FileTextIcon class="w-4 h-4" />
        Email Templates
      </span>
    </button>
  </div>

  {#if activeTab === 'smtp'}
    <form
      method="POST"
      action="?/update"
      use:enhance={() => {
        loading = true;
        return async ({ update }) => {
          await update();
          loading = false;
        };
      }}
    >
      <Card.Root>
        <Card.Header>
          <Card.Title>SMTP Configuration</Card.Title>
          <Card.Description>
            Configure your SMTP server settings for sending transactional emails.
          </Card.Description>
        </Card.Header>

        <Card.Content class="space-y-6">
          <div class="space-y-6">
            <div class="space-y-4">
              <div>
                <h3 class="text-lg font-medium">Server Settings</h3>
                <p class="text-sm text-muted-foreground">Configure your SMTP server connection details.</p>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div class="space-y-2">
                  <Label.Root for="smtpHost">SMTP Host <span class="text-destructive">*</span></Label.Root>
                  <Input.Root id="smtpHost" name="smtpHost" type="text" placeholder="smtp.gmail.com" bind:value={smtpHost} disabled={data.isDemoMode} required />
                  <p class="text-xs text-muted-foreground">Your SMTP server hostname</p>
                </div>
                <div class="space-y-2">
                  <Label.Root for="smtpPort">SMTP Port</Label.Root>
                  <Input.Root id="smtpPort" name="smtpPort" type="number" placeholder="587" bind:value={smtpPort} disabled={data.isDemoMode} min="1" max="65535" />
                  <p class="text-xs text-muted-foreground">Common: 587 (STARTTLS), 465 (SSL)</p>
                </div>
              </div>

              <div class="space-y-2">
                <Label.Root for="smtpSecure">Security</Label.Root>
                <Select.Root type="single" name="smtpSecure" bind:value={smtpSecure} disabled={data.isDemoMode}>
                  <Select.Trigger>{selectedSecurity().label}</Select.Trigger>
                  <Select.Content>
                    {#each securityOptions as option}
                      <Select.Item value={option.value} label={option.label}>{option.label}</Select.Item>
                    {/each}
                  </Select.Content>
                </Select.Root>
              </div>
            </div>

            <Separator />

            <div class="space-y-4">
              <div>
                <h3 class="text-lg font-medium">Authentication</h3>
                <p class="text-sm text-muted-foreground">Your SMTP server login credentials.</p>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div class="space-y-2">
                  <Label.Root for="smtpUser">Username <span class="text-destructive">*</span></Label.Root>
                  <Input.Root id="smtpUser" name="smtpUser" type="text" placeholder="your-email@example.com" bind:value={smtpUser} disabled={data.isDemoMode} required />
                </div>
                <div class="space-y-2">
                  <Label.Root for="smtpPass">Password <span class="text-destructive">*</span></Label.Root>
                  <div class="relative">
                    <Input.Root id="smtpPass" name="smtpPass" type={showPassword ? "text" : "password"} placeholder="Your SMTP password" bind:value={smtpPass} disabled={data.isDemoMode} required class="pr-10" />
                    <Button.Root type="button" variant="ghost" size="icon" class="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent" onclick={() => (showPassword = !showPassword)} disabled={data.isDemoMode}>
                      {#if showPassword}
                        <EyeOffIcon class="h-4 w-4" />
                      {:else}
                        <EyeIcon class="h-4 w-4" />
                      {/if}
                    </Button.Root>
                  </div>
                  <p class="text-xs text-muted-foreground">Stored encrypted</p>
                </div>
              </div>
            </div>

            <Separator />

            <div class="space-y-4">
              <div>
                <h3 class="text-lg font-medium">Email Identity</h3>
                <p class="text-sm text-muted-foreground">How emails will appear to recipients.</p>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div class="space-y-2">
                  <Label.Root for="fromEmail">From Email</Label.Root>
                  <Input.Root id="fromEmail" name="fromEmail" type="email" placeholder="noreply@yoursite.com" bind:value={fromEmail} disabled={data.isDemoMode} />
                </div>
                <div class="space-y-2">
                  <Label.Root for="fromName">From Name</Label.Root>
                  <Input.Root id="fromName" name="fromName" type="text" placeholder="Your Company Name" bind:value={fromName} disabled={data.isDemoMode} />
                </div>
              </div>
            </div>

            <Separator />

            <div class="space-y-4">
              <div>
                <h3 class="text-lg font-medium">Admin Notifications</h3>
                <p class="text-sm text-muted-foreground">Email address that receives a notification whenever a user places an order (manual or automatic). Leave blank to use the From Email above.</p>
              </div>
              <div class="space-y-2">
                <Label.Root for="adminNotificationEmail">Admin notification email</Label.Root>
                <Input.Root id="adminNotificationEmail" name="adminNotificationEmail" type="email" placeholder="admin@yoursite.com" bind:value={adminNotificationEmail} disabled={data.isDemoMode} />
              </div>
            </div>

            {#if form?.error && !form?.templateError}
              <div class="rounded-md bg-destructive/15 p-3">
                <p class="text-sm text-destructive">{form.error}</p>
              </div>
            {/if}

            {#if showSuccess}
              <div class="rounded-md bg-green-50 dark:bg-green-950/50 p-3">
                <p class="text-sm text-green-700 dark:text-green-400">Mailing settings saved successfully!</p>
              </div>
            {/if}
          </div>
        </Card.Content>
      </Card.Root>

      <div class="mt-4 flex justify-end">
        <Button.Root type="submit" disabled={loading || data.isDemoMode}>
          {loading ? "Saving..." : data.isDemoMode ? "Demo Mode - Read Only" : "Save Mailing Settings"}
        </Button.Root>
      </div>
    </form>

    <Card.Root class="mt-4">
      <Card.Header>
        <Card.Title class="text-base">Send Test Email</Card.Title>
        <Card.Description>
          Verify your SMTP configuration by sending a test email. Save your settings first before testing.
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <div class="flex gap-2 items-start">
          <div class="flex-1 space-y-1">
            <Input.Root
              type="email"
              placeholder="recipient@example.com"
              bind:value={testEmail}
              disabled={testEmailSending}
            />
          </div>
          <Button.Root
            type="button"
            variant="outline"
            disabled={testEmailSending || !testEmail}
            onclick={sendTestEmail}
          >
            {testEmailSending ? 'Sending...' : 'Send Test Email'}
          </Button.Root>
        </div>

        {#if testEmailResult}
          <div class="mt-3 rounded-md px-3 py-2.5 text-sm {testEmailResult.ok ? 'bg-green-50 dark:bg-green-950/50 text-green-700 dark:text-green-400' : 'bg-destructive/15 text-destructive'}">
            {testEmailResult.msg}
          </div>
        {/if}
      </Card.Content>
    </Card.Root>
  {:else}
    {#if editingTemplate}
      <Card.Root>
        <Card.Header>
          <div class="flex items-center justify-between">
            <div>
              <Card.Title>Edit: {getEditingLabel()}</Card.Title>
              <Card.Description>Customize the email subject and HTML body. Use {'{{variableName}}'} placeholders.</Card.Description>
            </div>
            <Button.Root variant="ghost" size="icon" onclick={closeEditor}>
              <XIcon class="w-5 h-5" />
            </Button.Root>
          </div>
        </Card.Header>
        <Card.Content class="space-y-4">
          <div class="space-y-2">
            <Label.Root for="editSubject">Subject Line</Label.Root>
            <Input.Root id="editSubject" type="text" bind:value={editSubject} placeholder="Email subject..." />
          </div>

          <div class="space-y-2">
            <Label.Root for="editHtml">HTML Body</Label.Root>
            <textarea
              id="editHtml"
              bind:value={editHtml}
              class="w-full min-h-[400px] rounded-md border bg-transparent px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Email HTML content..."
            ></textarea>
          </div>

          <div class="rounded-md border p-3">
            <p class="text-sm font-medium mb-2">Available Variables</p>
            <div class="flex flex-wrap gap-1.5">
              {#each getEditingVars() as v}
                <Badge variant="secondary" class="font-mono text-xs">{`{{${v}}}`}</Badge>
              {/each}
            </div>
          </div>

          <div class="flex items-center justify-between pt-2">
            <div class="flex gap-2">
              <Button.Root variant="outline" size="sm" onclick={restoreDefault}>
                <RotateCcwIcon class="w-4 h-4 mr-1" />
                Restore Default
              </Button.Root>
              <form method="POST" action="?/resetTemplate" use:enhance={() => {
                return async ({ update }) => { await update(); };
              }}>
                <input type="hidden" name="templateName" value={editingTemplate} />
                <Button.Root type="submit" variant="outline" size="sm" disabled={data.isDemoMode}>
                  <RotateCcwIcon class="w-4 h-4 mr-1" />
                  Reset to Default (Save)
                </Button.Root>
              </form>
            </div>
            <form method="POST" action="?/saveTemplate" use:enhance={() => {
              savingTemplate = true;
              return async ({ update }) => {
                await update();
                savingTemplate = false;
              };
            }}>
              <input type="hidden" name="templateName" value={editingTemplate} />
              <input type="hidden" name="subject" value={editSubject} />
              <input type="hidden" name="html" value={editHtml} />
              <Button.Root type="submit" disabled={savingTemplate || data.isDemoMode}>
                <SaveIcon class="w-4 h-4 mr-1" />
                {savingTemplate ? 'Saving...' : 'Save Template'}
              </Button.Root>
            </form>
          </div>
        </Card.Content>
      </Card.Root>
    {:else}
      <Card.Root>
        <Card.Header>
          <Card.Title>Email Templates</Card.Title>
          <Card.Description>Customize the look and content of all system emails. Click edit to modify a template.</Card.Description>
        </Card.Header>
        <Card.Content>
          <div class="space-y-2">
            {#each data.templates || [] as template}
              <div class="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <p class="font-medium text-sm">{template.label}</p>
                    {#if template.isCustom}
                      <Badge variant="default" class="text-xs">Customized</Badge>
                    {:else}
                      <Badge variant="secondary" class="text-xs">Default</Badge>
                    {/if}
                  </div>
                  <p class="text-xs text-muted-foreground mt-0.5 truncate">{template.description}</p>
                  <p class="text-xs text-muted-foreground mt-0.5 font-mono truncate">Subject: {template.subject}</p>
                </div>
                <Button.Root
                  variant="outline"
                  size="sm"
                  class="ml-3 flex-shrink-0"
                  disabled={templateLoading}
                  onclick={() => loadTemplateForEdit(template.name)}
                >
                  <EditIcon class="w-4 h-4 mr-1" />
                  Edit
                </Button.Root>
              </div>
            {/each}

            {#if !data.templates || data.templates.length === 0}
              <p class="text-center text-muted-foreground py-8">No email templates found.</p>
            {/if}
          </div>
        </Card.Content>
      </Card.Root>
    {/if}
  {/if}
</div>
