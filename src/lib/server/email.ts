import nodemailer from 'nodemailer'
import { env } from '$env/dynamic/private'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getMailingSettings } from './admin-settings'
import { getPublicOrigin, getLogoUrlLight, getLogoWidth, getLogoHeight, getSiteName } from './settings-store'
import { EmailTemplateService } from './email-templates.js'

// Email configuration types
/**
 * Email message configuration
 */
export interface EmailOptions {
  to: string
  subject: string
  html: string
  text: string
}

/**
 * Welcome email template data
 */
export interface WelcomeEmailData {
  name: string
  email: string
  verificationUrl?: string // Optional verification URL for email/password registrations
}

/**
 * Password reset email template data
 */
export interface PasswordResetEmailData {
  name: string
  email: string
  resetUrl: string
}

// Template utility functions
/**
 * Load an email template from the sys-email-templates directory
 * @param templateName - Name of the template file (without .html extension)
 * @returns HTML content of the template
 */
function loadEmailTemplate(templateName: string): string {
  try {
    const templatePath = join(process.cwd(), 'src', 'lib', 'server', 'sys-email-templates', `${templateName}.html`)
    const templateContent = readFileSync(templatePath, 'utf-8')

    // Basic validation that we loaded actual content
    if (!templateContent || templateContent.trim().length === 0) {
      throw new Error(`Template ${templateName} is empty or invalid`)
    }

    console.log(`[Email Service] Successfully loaded template: ${templateName}`)
    return templateContent
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[Email Service] Failed to load template ${templateName}: ${errorMessage}`)
    throw new Error(`Failed to load email template: ${templateName} - ${errorMessage}`)
  }
}

/**
 * Validate that a template contains all required placeholders
 * @param template - HTML template content
 * @param requiredVariables - Array of required variable names
 * @returns Array of missing variables, empty if all present
 */
function validateTemplate(template: string, requiredVariables: string[]): string[] {
  const missing: string[] = []

  for (const variable of requiredVariables) {
    const placeholder = `{{${variable}}}`
    if (!template.includes(placeholder)) {
      missing.push(variable)
    }
  }

  return missing
}

/**
 * Process an email template by replacing placeholders with actual values
 * @param template - HTML template content
 * @param variables - Object containing variable values
 * @returns Processed HTML content
 */
function processEmailTemplate(template: string, variables: Record<string, any>): string {
  // Validate required placeholders for welcome email
  const requiredVars = ['platformName', 'displayName', 'publicOrigin']
  const missingVars = validateTemplate(template, requiredVars)

  if (missingVars.length > 0) {
    console.warn(`[Email Service] Template missing required placeholders: ${missingVars.join(', ')}`)
  }

  let processedTemplate = template

  // Replace simple variables
  Object.entries(variables).forEach(([key, value]) => {
    const placeholder = `{{${key}}}`
    processedTemplate = processedTemplate.replace(new RegExp(placeholder, 'g'), String(value || ''))
  })

  // Handle conditional blocks for verification
  if (variables.isVerificationRequired) {
    // Show verification content
    processedTemplate = processedTemplate.replace(
      /{{#if isVerificationRequired}}([\s\S]*?){{\/if}}/g,
      '$1'
    )
    // Hide non-verification content
    processedTemplate = processedTemplate.replace(
      /{{#unless isVerificationRequired}}([\s\S]*?){{\/unless}}/g,
      ''
    )
  } else {
    // Hide verification content
    processedTemplate = processedTemplate.replace(
      /{{#if isVerificationRequired}}([\s\S]*?){{\/if}}/g,
      ''
    )
    // Show non-verification content
    processedTemplate = processedTemplate.replace(
      /{{#unless isVerificationRequired}}([\s\S]*?){{\/unless}}/g,
      '$1'
    )
  }

  // Clean up any remaining unmatched placeholders
  processedTemplate = processedTemplate.replace(/{{[^}]*}}/g, '')

  return processedTemplate
}

/**
 * Email service for sending transactional emails via SMTP
 */
class EmailService {
  private transporter: nodemailer.Transporter | null = null
  private isConfigured = false
  private cachedSmtpConfig: any = null
  private cacheTimestamp: number = 0
  private readonly CACHE_DURATION = 30000 // 30 seconds

  constructor() {
    // Initialize asynchronously - the service will be marked as not configured until initialization completes
    this.initializeTransporter()
  }

  // Get SMTP configuration with fallback logic: admin settings first, then environment variables
  private async getSmtpConfig() {
    // Check if we have a valid cached config
    const now = Date.now()
    if (this.cachedSmtpConfig && (now - this.cacheTimestamp < this.CACHE_DURATION)) {
      return this.cachedSmtpConfig
    }

    let smtpConfig: any

    try {
      // Try to get settings from admin dashboard first
      const adminSettings = await getMailingSettings()

      if (adminSettings.smtp_host && adminSettings.smtp_user && adminSettings.smtp_pass) {
        console.log('[Email Service] Using SMTP configuration from admin settings')
        smtpConfig = {
          host: adminSettings.smtp_host,
          port: parseInt(adminSettings.smtp_port || '587'),
          secure: adminSettings.smtp_secure === 'true',
          user: adminSettings.smtp_user,
          pass: adminSettings.smtp_pass,
          fromEmail: adminSettings.from_email,
          fromName: adminSettings.from_name,
          source: 'admin settings'
        }
      }
    } catch (error) {
      console.warn('[Email Service] Failed to load admin settings, falling back to environment variables:', error)
    }

    // Fall back to environment variables if admin settings are not available
    if (!smtpConfig) {
      console.log('[Email Service] Using SMTP configuration from environment variables')
      smtpConfig = {
        host: env.SMTP_HOST || '',
        port: parseInt(env.SMTP_PORT || '587'),
        secure: env.SMTP_SECURE === 'true',
        user: env.SMTP_USER || '',
        pass: env.SMTP_PASS || '',
        fromEmail: env.FROM_EMAIL,
        fromName: env.FROM_NAME,
        source: 'environment variables'
      }
    }

    // Cache the configuration
    this.cachedSmtpConfig = smtpConfig
    this.cacheTimestamp = now

    return smtpConfig
  }

  private async initializeTransporter() {
    try {
      // Get SMTP configuration with fallback logic
      const smtpConfig = await this.getSmtpConfig()

      if (!smtpConfig.host || !smtpConfig.user || !smtpConfig.pass) {
        console.warn('[Email Service] SMTP configuration not found. Email service will be disabled.')
        return
      }

      // Create reusable transporter object using SMTP transport
      this.transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        auth: {
          user: smtpConfig.user,
          pass: smtpConfig.pass,
        },
        // Additional options for better compatibility
        tls: {
          rejectUnauthorized: false // Allow self-signed certificates (for development)
        }
      })

      this.isConfigured = true
      console.log(`[Email Service] SMTP transporter configured successfully using ${smtpConfig.source}`)
    } catch (error) {
      console.error('[Email Service] Failed to configure SMTP transporter:', error)
      this.transporter = null
      this.isConfigured = false
    }
  }

  // Test SMTP connection
  async testConnection(): Promise<boolean> {
    if (!this.transporter || !this.isConfigured) {
      console.warn('[Email Service] Transporter not configured')
      return false
    }

    try {
      await this.transporter.verify()
      console.log('[Email Service] SMTP connection verified successfully')
      return true
    } catch (error) {
      console.error('[Email Service] SMTP connection test failed:', error)
      return false
    }
  }

  // Send email with retry logic
  async sendEmail(options: EmailOptions): Promise<boolean> {
    if (!this.transporter || !this.isConfigured) {
      console.warn('[Email Service] Cannot send email - service not configured')
      return false
    }

    try {
      // Get current SMTP configuration for "from" fields
      const smtpConfig = await this.getSmtpConfig()
      const fromEmail = smtpConfig.fromEmail || smtpConfig.user
      const fromName = smtpConfig.fromName || await getSiteName()

      const mailOptions = {
        from: `${fromName} <${fromEmail}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      }

      const info = await this.transporter.sendMail(mailOptions)
      console.log('[Email Service] Email sent successfully:', {
        messageId: info.messageId,
        to: options.to,
        subject: options.subject
      })
      return true
    } catch (error) {
      console.error('[Email Service] Failed to send email:', error)
      return false
    }
  }

  // Welcome email template
  async generateWelcomeEmail(data: WelcomeEmailData): Promise<{ html: string; text: string }> {
    const { name, email, verificationUrl } = data
    const smtpConfig = await this.getSmtpConfig()
    const platformName = smtpConfig.fromName || await getSiteName()
    const displayName = name || email.split('@')[0]
    const isVerificationRequired = !!verificationUrl
    const publicOrigin = await getPublicOrigin()

    // Get logo settings for email header
    const logoUrlLight = await getLogoUrlLight()
    const logoWidth = await getLogoWidth()
    const logoHeight = await getLogoHeight()

    // Build absolute URL for email clients (they don't resolve relative URLs)
    const logoUrl = logoUrlLight.startsWith('http')
      ? logoUrlLight
      : `${publicOrigin}${logoUrlLight}`

    let html: string

    try {
      // Load and process the HTML template
      console.log(`[Email Service] Generating welcome email (verification: ${isVerificationRequired})`)
      const template = loadEmailTemplate('welcome-verify-email')
      html = processEmailTemplate(template, {
        platformName,
        displayName,
        verificationUrl: verificationUrl || '',
        isVerificationRequired,
        publicOrigin,
        logoUrl,
        logoWidth,
        logoHeight
      })
      console.log('[Email Service] Successfully processed welcome email template')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[Email Service] Template processing failed for welcome email: ${errorMessage}`)
      console.log('[Email Service] Using fallback template for welcome email')
      // Fallback to a simple but complete HTML template
      html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to ${platformName}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
    .container { background: #f9f9f9; padding: 30px; border-radius: 8px; }
    .button { background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 10px 0; }
    .verify-button { background: #059669; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Welcome, ${displayName}! 🎉</h1>
    <p>Thank you for joining our AI models platform!</p>
    ${isVerificationRequired ? `
    <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 15px; margin: 15px 0;">
      <strong>Please verify your email address</strong><br>
      <small>Click the button below to complete your account setup.</small>
    </div>
    <a href="${verificationUrl}" class="button verify-button">✉️ Verify Email Address</a><br>
    ` : ''}
    <a href="${publicOrigin}" class="button">Start Creating</a>
    <p><small>Welcome to the future of AI interaction!</small></p>
  </div>
</body>
</html>`
    }

    const text = `
Welcome to ${platformName}, ${displayName}! 🎉

Thank you for joining our AI models platform! We're excited to have you on board.

${isVerificationRequired ? `
⚠️  IMPORTANT: Please verify your email address
To complete your account setup, please visit the verification link below:
${verificationUrl}

` : ''}You now have access to:
• 65+ AI models from 9 different providers
• Text generation with Claude, GPT, Gemini, and more
• Image generation with DALL-E, Stable Diffusion, FLUX
• Video generation with cutting-edge AI models
• Seamless conversation history across all models
• Multimodal chat with image and text support

${isVerificationRequired ? 'After verifying your email, start creating at:' : 'Ready to start creating? Visit:'} ${publicOrigin}

Welcome to the future of AI interaction!

If you have any questions, feel free to reach out to our support team.

---
${platformName}
`

    return { html, text }
  }

  // Password reset email template
  async generatePasswordResetEmail(data: PasswordResetEmailData): Promise<{ html: string; text: string }> {
    const { name, email, resetUrl } = data
    const smtpConfig = await this.getSmtpConfig()
    const platformName = smtpConfig.fromName || await getSiteName()
    const displayName = name || email.split('@')[0]
    const publicOrigin = await getPublicOrigin()

    // Get logo settings for email header
    const logoUrlLight = await getLogoUrlLight()
    const logoWidth = await getLogoWidth()
    const logoHeight = await getLogoHeight()

    // Build absolute URL for email clients (they don't resolve relative URLs)
    const logoUrl = logoUrlLight.startsWith('http')
      ? logoUrlLight
      : `${publicOrigin}${logoUrlLight}`

    let html: string

    try {
      // Load and process the HTML template
      console.log(`[Email Service] Generating password reset email`)
      const template = loadEmailTemplate('reset-password')
      html = processEmailTemplate(template, {
        platformName,
        displayName,
        resetUrl,
        publicOrigin,
        logoUrl,
        logoWidth,
        logoHeight
      })
      console.log('[Email Service] Successfully processed password reset email template')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[Email Service] Template processing failed for password reset email: ${errorMessage}`)
      console.log('[Email Service] Using fallback template for password reset email')
      // Fallback to a simple but complete HTML template
      html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password - ${platformName}</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
    .container { background: #f9f9f9; padding: 30px; border-radius: 8px; }
    .button { background: #dc2626; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 15px 0; }
    .warning { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 15px; margin: 15px 0; color: #92400e; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Reset Your Password 🔐</h1>
    <p>Hello ${displayName},</p>
    <p>We received a request to reset your password for your ${platformName} account.</p>
    <div class="warning">
      <strong>Security Notice:</strong> This link expires in 24 hours and can only be used once.
    </div>
    <a href="${resetUrl}" class="button">Reset My Password</a>
    <p><strong>Didn't request this?</strong> You can safely ignore this email.</p>
    <p><small>If you have questions, contact our support team.</small></p>
  </div>
</body>
</html>`
    }

    const text = `
Reset Your Password - ${platformName}

Hello ${displayName},

We received a request to reset the password for your ${platformName} account.

If you requested this password reset, click the link below to create a new password:
${resetUrl}

SECURITY NOTICE:
- This password reset link will expire in 24 hours
- The link can only be used once
- If you didn't request this, you can safely ignore this email

Security Tips:
• Choose a strong password with at least 8 characters
• Use a mix of letters, numbers, and special characters
• Don't reuse passwords from other accounts
• Consider using a password manager

If you continue to receive these emails or have concerns about your account security, please contact our support team immediately.

---
${platformName}
${publicOrigin}
`

    return { html, text }
  }

  /**
   * Send welcome email to new users
   * @param userData - User data for email personalization
   * @returns Promise indicating success/failure
   */
  async sendWelcomeEmail(userData: WelcomeEmailData): Promise<boolean> {
    const { html, text } = await this.generateWelcomeEmail(userData)
    const smtpConfig = await this.getSmtpConfig()
    const platformName = smtpConfig.fromName || await getSiteName()

    return await this.sendEmail({
      to: userData.email,
      subject: `Welcome to ${platformName}`,
      html,
      text
    })
  }

  /**
   * Send password reset email to users
   * @param userData - User data for email personalization
   * @returns Promise indicating success/failure
   */
  async sendPasswordResetEmail(userData: PasswordResetEmailData): Promise<boolean> {
    const { html, text } = await this.generatePasswordResetEmail(userData)
    const smtpConfig = await this.getSmtpConfig()
    const platformName = smtpConfig.fromName || await getSiteName()

    return await this.sendEmail({
      to: userData.email,
      subject: `Reset Your Password - ${platformName}`,
      html,
      text
    })
  }

  private async getCommonVars() {
    const smtpConfig = await this.getSmtpConfig()
    const platformName = smtpConfig.fromName || await getSiteName()
    const publicOrigin = await getPublicOrigin()
    const logoUrlLight = await getLogoUrlLight()
    const logoWidth = await getLogoWidth()
    const logoHeight = await getLogoHeight()
    const logoUrl = logoUrlLight.startsWith('http') ? logoUrlLight : `${publicOrigin}${logoUrlLight}`
    return { platformName, publicOrigin, logoUrl, logoWidth, logoHeight }
  }

  private async sendTemplatedEmail(
    templateName: string,
    to: string,
    variables: Record<string, any>,
    subjectOverride?: string
  ): Promise<boolean> {
    const template = await EmailTemplateService.getTemplate(templateName)
    if (!template) {
      console.error(`[Email Service] Template not found: ${templateName}`)
      return false
    }

    const common = await this.getCommonVars()
    const allVars = { ...common, ...variables }

    let subject = subjectOverride || template.subject
    Object.entries(allVars).forEach(([key, value]) => {
      subject = subject.replace(new RegExp(`{{${key}}}`, 'g'), String(value || ''))
    })

    const html = processEmailTemplate(template.html, allVars)
    const text = subject

    return await this.sendEmail({ to, subject, html, text })
  }

  async sendOtpEmail(data: { email: string; name?: string; otpCode: string; expiryMinutes?: number }): Promise<boolean> {
    return this.sendTemplatedEmail('otp-verification', data.email, {
      displayName: data.name || data.email.split('@')[0],
      otpCode: data.otpCode,
      expiryMinutes: data.expiryMinutes || 10,
    })
  }

  async sendPlanPurchaseEmail(data: {
    email: string; name?: string; planName: string; amount: string; billingPeriod: string; nextBillingDate: string
  }): Promise<boolean> {
    return this.sendTemplatedEmail('plan-purchase', data.email, {
      displayName: data.name || data.email.split('@')[0],
      planName: data.planName,
      amount: data.amount,
      billingPeriod: data.billingPeriod,
      nextBillingDate: data.nextBillingDate,
    })
  }

  async sendCreditPurchaseEmail(data: {
    email: string; name?: string; creditPackName: string; creditAmount: number; creditType: string; amount: string
  }): Promise<boolean> {
    return this.sendTemplatedEmail('credit-purchase', data.email, {
      displayName: data.name || data.email.split('@')[0],
      creditPackName: data.creditPackName,
      creditAmount: data.creditAmount,
      creditType: data.creditType,
      amount: data.amount,
    })
  }

  async sendExpiryWarningEmail(data: {
    email: string; name?: string; planName: string; expiryDate: string; daysRemaining: number
  }): Promise<boolean> {
    return this.sendTemplatedEmail('subscription-expiry', data.email, {
      displayName: data.name || data.email.split('@')[0],
      planName: data.planName,
      expiryDate: data.expiryDate,
      daysRemaining: data.daysRemaining,
    })
  }

  async sendPlanUpgradeEmail(data: {
    email: string; name?: string; previousPlan: string; newPlan: string; amount: string; effectiveDate: string
  }): Promise<boolean> {
    return this.sendTemplatedEmail('plan-upgrade', data.email, {
      displayName: data.name || data.email.split('@')[0],
      previousPlan: data.previousPlan,
      newPlan: data.newPlan,
      amount: data.amount,
      effectiveDate: data.effectiveDate,
    })
  }

  async sendNoticeEmail(data: {
    email: string; name?: string; heading: string; message: string; subject?: string; actionUrl?: string; actionText?: string
  }): Promise<boolean> {
    return this.sendTemplatedEmail('general-notice', data.email, {
      displayName: data.name || data.email.split('@')[0],
      heading: data.heading,
      message: data.message,
      subject: data.subject || data.heading,
      actionUrl: data.actionUrl || '',
      actionText: data.actionText || 'Learn More',
    }, data.subject ? `${data.subject}` : undefined)
  }

  /**
   * Reconfigure the email service when settings change
   * This method should be called when admin settings are updated
   */
  async reconfigure(): Promise<boolean> {
    console.log('[Email Service] Reconfiguring email service due to settings change')

    // Clear the cached configuration
    this.cachedSmtpConfig = null
    this.cacheTimestamp = 0

    // Reset transporter
    this.transporter = null
    this.isConfigured = false

    // Initialize with new settings
    await this.initializeTransporter()
    return this.isConfigured
  }
}

// Create singleton instance
export const emailService = new EmailService()

// Export utility functions
export const sendWelcomeEmail = (userData: WelcomeEmailData) => emailService.sendWelcomeEmail(userData)
export const sendPasswordResetEmail = (userData: PasswordResetEmailData) => emailService.sendPasswordResetEmail(userData)
export const testEmailConnection = () => emailService.testConnection()
export const sendOtpEmail = (data: Parameters<typeof emailService.sendOtpEmail>[0]) => emailService.sendOtpEmail(data)
export const sendPlanPurchaseEmail = (data: Parameters<typeof emailService.sendPlanPurchaseEmail>[0]) => emailService.sendPlanPurchaseEmail(data)
export const sendCreditPurchaseEmail = (data: Parameters<typeof emailService.sendCreditPurchaseEmail>[0]) => emailService.sendCreditPurchaseEmail(data)
export const sendExpiryWarningEmail = (data: Parameters<typeof emailService.sendExpiryWarningEmail>[0]) => emailService.sendExpiryWarningEmail(data)
export const sendPlanUpgradeEmail = (data: Parameters<typeof emailService.sendPlanUpgradeEmail>[0]) => emailService.sendPlanUpgradeEmail(data)
export const sendNoticeEmail = (data: Parameters<typeof emailService.sendNoticeEmail>[0]) => emailService.sendNoticeEmail(data)


// ============================================================================
// Admin notification helpers
// ============================================================================

export interface AdminOrderNotification {
  source: 'manual' | 'opaybd-subscription' | 'opaybd-credit'
  orderType: 'subscription' | 'credit'
  userId: string | null
  userEmail: string | null
  userName?: string | null
  planName: string
  amount: number          // in major units (e.g. dollars, taka) — already divided
  currency: string        // e.g. 'usd' | 'bdt'
  gateway: string         // 'paypal' | 'opaybd' | etc
  txnReference?: string | null
  senderInfo?: string | null
  userNotes?: string | null
  orderId?: string | null
  status: 'pending-verification' | 'completed'
}

/**
 * Resolve the admin notification email address.
 * Prefers admin_notification_email setting; falls back to from_email; then SMTP user.
 */
async function resolveAdminNotificationEmail(): Promise<string | null> {
  try {
    const { adminSettingsService } = await import('./admin-settings.js')
    const adminEmail = await adminSettingsService.getSetting('admin_notification_email')
    if (adminEmail && adminEmail.includes('@')) return adminEmail
    const settings = await getMailingSettings()
    const fallback = (settings as any)?.from_email || (settings as any)?.smtp_user
    return fallback || null
  } catch (e) {
    console.error('[Admin Notify] Failed to resolve admin email:', e)
    return null
  }
}

/**
 * Send admin a notification when ANY order is placed (manual or auto).
 * Non-blocking: errors are logged but never thrown.
 */
export async function sendAdminOrderNotification(n: AdminOrderNotification): Promise<void> {
  try {
    const adminEmail = await resolveAdminNotificationEmail()
    if (!adminEmail) {
      console.warn('[Admin Notify] No admin email configured — skipping')
      return
    }

    const platformName = await getSiteName()
    const publicOrigin = await getPublicOrigin()

    const isManual = n.source === 'manual'
    const subjectPrefix = isManual
      ? '[Action Needed] New manual payment submission'
      : '[Order] New payment received'
    const orderTypeLabel = n.orderType === 'credit' ? 'Credit pack' : 'Subscription plan'
    const statusLabel = n.status === 'pending-verification'
      ? 'PENDING — verify and approve in admin panel'
      : 'AUTO-COMPLETED'
    const amountStr = `${n.amount.toFixed(2)} ${n.currency.toUpperCase()}`

    const reviewUrl = `${publicOrigin}/admin/orders${isManual ? '?tab=new' : ''}`

    const html = `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f5f7;padding:24px;color:#111">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e5ea">
    <div style="background:${isManual ? '#fff7ed' : '#eff6ff'};padding:18px 24px;border-bottom:1px solid #e5e5ea">
      <div style="font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:${isManual ? '#9a3412' : '#1e40af'};font-weight:600">${platformName} · Admin notification</div>
      <div style="font-size:18px;font-weight:700;margin-top:4px">${subjectPrefix}</div>
    </div>
    <div style="padding:20px 24px">
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 0;color:#666;width:140px">Status</td><td style="padding:6px 0;font-weight:600;color:${n.status === 'pending-verification' ? '#b45309' : '#15803d'}">${statusLabel}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Order type</td><td style="padding:6px 0">${orderTypeLabel}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Plan / Pack</td><td style="padding:6px 0;font-weight:600">${n.planName}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Amount</td><td style="padding:6px 0;font-weight:600">${amountStr}</td></tr>
        <tr><td style="padding:6px 0;color:#666">Gateway</td><td style="padding:6px 0;text-transform:capitalize">${n.gateway}</td></tr>
        <tr><td style="padding:6px 0;color:#666">User</td><td style="padding:6px 0">${n.userName || '—'}${n.userEmail ? ` &lt;${n.userEmail}&gt;` : ''}</td></tr>
        ${n.userId ? `<tr><td style="padding:6px 0;color:#666">User ID</td><td style="padding:6px 0;font-family:monospace;font-size:12px">${n.userId}</td></tr>` : ''}
        ${n.txnReference ? `<tr><td style="padding:6px 0;color:#666">Txn / Ref</td><td style="padding:6px 0;font-family:monospace;font-size:12px;word-break:break-all">${n.txnReference}</td></tr>` : ''}
        ${n.senderInfo ? `<tr><td style="padding:6px 0;color:#666">Sender info</td><td style="padding:6px 0">${n.senderInfo}</td></tr>` : ''}
        ${n.userNotes ? `<tr><td style="padding:6px 0;color:#666;vertical-align:top">User notes</td><td style="padding:6px 0;white-space:pre-wrap">${n.userNotes}</td></tr>` : ''}
        ${n.orderId ? `<tr><td style="padding:6px 0;color:#666">Order ID</td><td style="padding:6px 0;font-family:monospace;font-size:12px">${n.orderId}</td></tr>` : ''}
      </table>
      <div style="margin-top:20px;text-align:center">
        <a href="${reviewUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">${isManual ? 'Review & verify order' : 'View in admin panel'}</a>
      </div>
      ${isManual ? `<p style="margin-top:18px;color:#666;font-size:13px;line-height:1.5">The user has submitted payment proof. Please verify the transaction on your gateway, then click <strong>Complete</strong> in the admin panel to activate their ${n.orderType === 'credit' ? 'credits' : 'subscription'}. The order will <strong>not</strong> be activated until you approve it.</p>` : ''}
    </div>
    <div style="background:#fafafa;padding:12px 24px;font-size:11px;color:#999;border-top:1px solid #e5e5ea">Automated notification from ${platformName}. Sent because an order was placed on your platform.</div>
  </div>
</body></html>`

    const text = `${subjectPrefix}

Status: ${statusLabel}
Type: ${orderTypeLabel}
Plan: ${n.planName}
Amount: ${amountStr}
Gateway: ${n.gateway}
User: ${n.userName || ''} <${n.userEmail || ''}>
${n.txnReference ? `Txn: ${n.txnReference}
` : ''}${n.userNotes ? `Notes: ${n.userNotes}
` : ''}
Review: ${reviewUrl}`

    await emailService.sendEmail({
      to: adminEmail,
      subject: `${subjectPrefix} · ${n.planName} (${amountStr})`,
      html,
      text,
    })
    console.log('[Admin Notify] Sent admin notification to', adminEmail, 'for', n.source, n.orderId || '')
  } catch (err) {
    console.error('[Admin Notify] Failed to send admin notification:', err)
  }
}

