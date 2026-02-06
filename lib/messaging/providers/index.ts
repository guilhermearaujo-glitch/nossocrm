/**
 * @fileoverview Channel Providers Index
 *
 * Exports all channel providers and registers them with the factory.
 *
 * @module lib/messaging/providers
 */

// Base provider
export { BaseChannelProvider } from './base.provider';

// WhatsApp providers
export { ZApiWhatsAppProvider, MetaCloudWhatsAppProvider } from './whatsapp';
export type {
  ZApiCredentials,
  ZApiWebhookPayload,
  MetaCloudCredentials,
  MetaCloudWebhookPayload,
} from './whatsapp';

// Instagram providers
export { MetaInstagramProvider } from './instagram';
export type { MetaInstagramCredentials } from './instagram';

// =============================================================================
// FACTORY REGISTRATION
// =============================================================================

import { registerProvider } from '../channel-factory';
import { ZApiWhatsAppProvider, MetaCloudWhatsAppProvider } from './whatsapp';
import { MetaInstagramProvider } from './instagram';

// Register Z-API provider
registerProvider({
  channelType: 'whatsapp',
  providerName: 'z-api',
  constructor: ZApiWhatsAppProvider,
  displayName: 'Z-API',
  description: 'WhatsApp via Z-API (não oficial, baseado em QR code)',
  configFields: [
    {
      key: 'instanceId',
      label: 'Instance ID',
      type: 'text',
      required: true,
      placeholder: 'seu-instance-id',
    },
    {
      key: 'token',
      label: 'Token',
      type: 'password',
      required: true,
      placeholder: 'seu-token',
    },
    {
      key: 'clientToken',
      label: 'Client Token (opcional)',
      type: 'password',
      required: false,
      placeholder: 'seu-client-token',
    },
  ],
  features: ['media', 'read_receipts', 'qr_code'],
});

// Register Meta Cloud API provider
registerProvider({
  channelType: 'whatsapp',
  providerName: 'meta-cloud',
  constructor: MetaCloudWhatsAppProvider,
  displayName: 'Meta Cloud API',
  description: 'WhatsApp oficial via Meta Business API (requer verificação)',
  configFields: [
    {
      key: 'phoneNumberId',
      label: 'Phone Number ID',
      type: 'text',
      required: true,
      placeholder: 'ID do número no Meta Business',
      helpText: 'Encontre no Meta Business Suite > WhatsApp > API Setup',
    },
    {
      key: 'accessToken',
      label: 'Access Token',
      type: 'password',
      required: true,
      placeholder: 'Token de acesso permanente',
      helpText: 'Gere um token permanente no Meta Business Suite',
    },
    {
      key: 'wabaId',
      label: 'WABA ID (opcional)',
      type: 'text',
      required: false,
      placeholder: 'ID da conta WhatsApp Business',
      helpText: 'Necessário para sincronizar templates',
    },
    {
      key: 'appSecret',
      label: 'App Secret (opcional)',
      type: 'password',
      required: false,
      placeholder: 'Segredo do app Meta',
      helpText: 'Para verificação de assinatura de webhooks',
    },
    {
      key: 'verifyToken',
      label: 'Verify Token (opcional)',
      type: 'text',
      required: false,
      placeholder: 'Token de verificação de webhook',
      helpText: 'Token customizado para validar configuração de webhook',
    },
  ],
  features: ['media', 'read_receipts', 'templates'],
});

// Register Meta Instagram provider
registerProvider({
  channelType: 'instagram',
  providerName: 'meta',
  constructor: MetaInstagramProvider,
  displayName: 'Meta (Instagram)',
  description: 'Instagram DM via Meta Messenger Platform API',
  configFields: [
    {
      key: 'pageId',
      label: 'Page ID',
      type: 'text',
      required: true,
      placeholder: 'ID da página Facebook vinculada',
      helpText: 'ID da página Facebook conectada à conta Instagram',
    },
    {
      key: 'instagramAccountId',
      label: 'Instagram Account ID',
      type: 'text',
      required: true,
      placeholder: 'ID da conta Instagram Business',
      helpText: 'Encontre no Meta Business Suite > Instagram > Configurações',
    },
    {
      key: 'accessToken',
      label: 'Access Token',
      type: 'password',
      required: true,
      placeholder: 'Token de acesso da página',
      helpText: 'Token com permissão instagram_manage_messages',
    },
    {
      key: 'appSecret',
      label: 'App Secret (opcional)',
      type: 'password',
      required: false,
      placeholder: 'Segredo do app Meta',
      helpText: 'Para verificação de assinatura de webhooks',
    },
    {
      key: 'verifyToken',
      label: 'Verify Token (opcional)',
      type: 'text',
      required: false,
      placeholder: 'Token de verificação de webhook',
      helpText: 'Token customizado para validar configuração de webhook',
    },
  ],
  features: ['media', 'read_receipts'],
});
