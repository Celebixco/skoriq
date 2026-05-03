import { Inject, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common";
import type { AppConfig } from "@sports-data/config";
import { loadConfig } from "@sports-data/config";

export interface PasswordResetEmailSender {
  readonly configured: boolean;
  sendPasswordResetEmail(input: { email: string; resetUrl: string }): Promise<void>;
}

@Injectable()
export class ResendPasswordResetEmailService implements PasswordResetEmailSender {
  private readonly config: AppConfig;

  constructor(@Optional() @Inject("AUTH_CONFIG") config?: AppConfig) {
    this.config = config ?? loadConfig();
  }

  get configured() {
    return Boolean(this.config.RESEND_API_KEY && this.config.AUTH_PASSWORD_RESET_FROM_EMAIL && this.passwordResetUrlBase);
  }

  async sendPasswordResetEmail(input: { email: string; resetUrl: string }) {
    if (!this.configured) {
      throw new ServiceUnavailableException("Şifre sıfırlama servisi henüz hazır değil.");
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: this.config.AUTH_PASSWORD_RESET_FROM_EMAIL,
        to: [input.email],
        subject: "SkorIQ sifre sifirlama baglantisi",
        text: buildResetText(input.resetUrl),
        html: buildResetHtml(input.resetUrl)
      })
    }).catch(() => {
      throw new ServiceUnavailableException("Şifre sıfırlama e-postası şu an gönderilemiyor.");
    });

    if (!response.ok) {
      throw new ServiceUnavailableException("Şifre sıfırlama e-postası şu an gönderilemiyor.");
    }
  }

  private get passwordResetUrlBase() {
    return this.config.AUTH_PASSWORD_RESET_URL_BASE ?? this.config.FRONTEND_ORIGIN;
  }
}

function buildResetText(resetUrl: string) {
  return [
    "SkorIQ sifrenizi yenilemek icin asagidaki baglantiyi kullanin:",
    resetUrl,
    "",
    "Bu baglanti sinirli sure boyunca gecerlidir. Talep size ait degilse bu e-postayi yok sayabilirsiniz."
  ].join("\n");
}

function buildResetHtml(resetUrl: string) {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827;">
      <h2 style="margin-bottom: 12px;">SkorIQ sifre yenileme</h2>
      <p>Sifrenizi yenilemek icin asagidaki baglantiyi kullanin:</p>
      <p><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p>
      <p>Bu baglanti sinirli sure boyunca gecerlidir. Talep size ait degilse bu e-postayi yok sayabilirsiniz.</p>
    </div>
  `.trim();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
