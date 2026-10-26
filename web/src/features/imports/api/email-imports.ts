import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ulid } from '@finance-tracker/domain';
import { env } from '@/shared/lib/env';
import { supabase } from '@/shared/lib/supabase-client';
import type { Tables } from '@/shared/types/database.types';

export type EmailImportSource = Omit<Tables<'email_import_sources'>, 'token_hash'>;
export type EmailImportMessage = Tables<'email_import_messages'>;

// token_hash is not granted to clients, so `select('*')` would be rejected.
const SOURCE_COLUMNS =
  'id, owner_email, paid_by, token_hint, allowed_sender_domains, import_after, last_used_at, revoked_at, created_at';
const MESSAGE_LOG_LIMIT = 30;

export const DEFAULT_SENDER_DOMAINS = [
  'amazon.de',
  'anthropic.com',
  'edeka.de',
  'google.com',
  'uber.com',
];
export const EMAIL_INGEST_URL = `${env.VITE_SUPABASE_URL.replace(/\/$/, '')}/functions/v1/ingest-email-receipts`;

export const emailImportSourcesQueryKey = ['email-import-sources'] as const;
export const emailImportMessagesQueryKey = ['email-import-messages'] as const;

export function parseSenderDomains(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,;]+/)
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function useEmailImportSources() {
  return useQuery({
    queryKey: emailImportSourcesQueryKey,
    queryFn: async (): Promise<EmailImportSource[]> => {
      const { data, error } = await supabase
        .from('email_import_sources')
        .select(SOURCE_COLUMNS)
        .is('revoked_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useEmailImportMessages() {
  return useQuery({
    queryKey: emailImportMessagesQueryKey,
    queryFn: async (): Promise<EmailImportMessage[]> => {
      const { data, error } = await supabase
        .from('email_import_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(MESSAGE_LOG_LIMIT);
      if (error) throw error;
      return data;
    },
    refetchInterval: 60_000,
  });
}

type CreateSourceInput = { paidBy: string; importAfter: Date; senderDomains: string[] };

/** Resolves to the plaintext token. The server keeps only its hash, so it is shown once. */
export function useCreateEmailImportSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ paidBy, importAfter, senderDomains }: CreateSourceInput) => {
      const { data, error } = await supabase.rpc('create_email_import_source', {
        p_id: ulid(),
        p_paid_by: paidBy,
        p_import_after: importAfter.toISOString(),
        p_sender_domains: senderDomains,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: emailImportSourcesQueryKey }),
  });
}

export function useSetEmailImportSenderDomains() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, senderDomains }: { id: string; senderDomains: string[] }) => {
      const { error } = await supabase.rpc('set_email_import_sender_domains', {
        p_id: id,
        p_sender_domains: senderDomains,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: emailImportSourcesQueryKey }),
  });
}

export function useRevokeEmailImportSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('revoke_email_import_source', { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: emailImportSourcesQueryKey }),
  });
}

export function useRetryEmailImportMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('retry_email_import_message', { p_message_id: id });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: emailImportMessagesQueryKey }),
  });
}
