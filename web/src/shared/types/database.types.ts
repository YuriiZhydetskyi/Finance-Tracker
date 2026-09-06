export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      app_users: {
        Row: {
          email: string;
        };
        Insert: {
          email: string;
        };
        Update: {
          email?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          group_name: string;
          name: string;
        };
        Insert: {
          group_name: string;
          name: string;
        };
        Update: {
          group_name?: string;
          name?: string;
        };
        Relationships: [];
      };
      items: {
        Row: {
          category: string;
          consumed_by: string;
          created_at: string;
          discount_orig: number;
          id: string;
          note: string | null;
          product_id: string | null;
          product_image_url: string | null;
          product_name: string;
          product_url: string | null;
          qty: number;
          receipt_id: string;
          store_product_code: string | null;
          total_eur: number;
          total_orig: number;
          unit_price_orig: number;
          updated_at: string;
          wasted_at: string | null;
          wasted_qty: number;
        };
        Insert: {
          category: string;
          consumed_by: string;
          created_at?: string;
          discount_orig?: number;
          id: string;
          note?: string | null;
          product_id?: string | null;
          product_image_url?: string | null;
          product_name: string;
          product_url?: string | null;
          qty: number;
          receipt_id: string;
          store_product_code?: string | null;
          total_eur: number;
          total_orig: number;
          unit_price_orig: number;
          updated_at?: string;
          wasted_at?: string | null;
          wasted_qty?: number;
        };
        Update: {
          category?: string;
          consumed_by?: string;
          created_at?: string;
          discount_orig?: number;
          id?: string;
          note?: string | null;
          product_id?: string | null;
          product_image_url?: string | null;
          product_name?: string;
          product_url?: string | null;
          qty?: number;
          receipt_id?: string;
          store_product_code?: string | null;
          total_eur?: number;
          total_orig?: number;
          unit_price_orig?: number;
          updated_at?: string;
          wasted_at?: string | null;
          wasted_qty?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'items_category_fkey';
            columns: ['category'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['name'];
          },
          {
            foreignKeyName: 'items_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'items_receipt_id_fkey';
            columns: ['receipt_id'];
            isOneToOne: false;
            referencedRelation: 'receipts';
            referencedColumns: ['id'];
          },
        ];
      };
      pending_parses: {
        Row: {
          attempts: number;
          created_at: string;
          error_message: string | null;
          id: string;
          original_filename: string | null;
          paid_by: string;
          photo_path: string;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          created_at?: string;
          error_message?: string | null;
          id: string;
          original_filename?: string | null;
          paid_by: string;
          photo_path: string;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          error_message?: string | null;
          id?: string;
          original_filename?: string | null;
          paid_by?: string;
          photo_path?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      product_prices: {
        Row: {
          created_at: string;
          currency: string;
          date: string;
          id: string;
          price_net: number;
          price_orig: number;
          product_id: string;
          receipt_id: string;
        };
        Insert: {
          created_at?: string;
          currency: string;
          date: string;
          id: string;
          price_net: number;
          price_orig: number;
          product_id: string;
          receipt_id: string;
        };
        Update: {
          created_at?: string;
          currency?: string;
          date?: string;
          id?: string;
          price_net?: number;
          price_orig?: number;
          product_id?: string;
          receipt_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'product_prices_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_prices_receipt_id_fkey';
            columns: ['receipt_id'];
            isOneToOne: false;
            referencedRelation: 'receipts';
            referencedColumns: ['id'];
          },
        ];
      };
      products: {
        Row: {
          category: string;
          created_at: string;
          id: string;
          name: string;
          notes: string | null;
          store: string;
          store_product_code: string | null;
          unit: Database['public']['Enums']['product_unit'] | null;
          unit_size: number | null;
          updated_at: string;
        };
        Insert: {
          category: string;
          created_at?: string;
          id: string;
          name: string;
          notes?: string | null;
          store?: string;
          store_product_code?: string | null;
          unit?: Database['public']['Enums']['product_unit'] | null;
          unit_size?: number | null;
          updated_at?: string;
        };
        Update: {
          category?: string;
          created_at?: string;
          id?: string;
          name?: string;
          notes?: string | null;
          store?: string;
          store_product_code?: string | null;
          unit?: Database['public']['Enums']['product_unit'] | null;
          unit_size?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'products_category_fkey';
            columns: ['category'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['name'];
          },
        ];
      };
      receipt_import_attempts: {
        Row: {
          analysis_run: number;
          computed_total: number | null;
          created_at: string;
          delivery_attempt: number;
          details: Json | null;
          diagnosis_code: string | null;
          difference: number | null;
          duration_ms: number | null;
          file_id: string;
          finished_at: string | null;
          id: number;
          input_tokens: number | null;
          model: string | null;
          output_tokens: number | null;
          printed_total: number | null;
          provider: string | null;
          provider_request_id: string | null;
          public_message: string | null;
          queue_message_id: number | null;
          result_json: Json | null;
          settings: Json;
          stage: string;
          started_at: string;
          status: string;
          stop_reason: string | null;
        };
        Insert: {
          analysis_run: number;
          computed_total?: number | null;
          created_at?: string;
          delivery_attempt: number;
          details?: Json | null;
          diagnosis_code?: string | null;
          difference?: number | null;
          duration_ms?: number | null;
          file_id: string;
          finished_at?: string | null;
          id?: never;
          input_tokens?: number | null;
          model?: string | null;
          output_tokens?: number | null;
          printed_total?: number | null;
          provider?: string | null;
          provider_request_id?: string | null;
          public_message?: string | null;
          queue_message_id?: number | null;
          result_json?: Json | null;
          settings?: Json;
          stage: string;
          started_at?: string;
          status: string;
          stop_reason?: string | null;
        };
        Update: {
          analysis_run?: number;
          computed_total?: number | null;
          created_at?: string;
          delivery_attempt?: number;
          details?: Json | null;
          diagnosis_code?: string | null;
          difference?: number | null;
          duration_ms?: number | null;
          file_id?: string;
          finished_at?: string | null;
          id?: never;
          input_tokens?: number | null;
          model?: string | null;
          output_tokens?: number | null;
          printed_total?: number | null;
          provider?: string | null;
          provider_request_id?: string | null;
          public_message?: string | null;
          queue_message_id?: number | null;
          result_json?: Json | null;
          settings?: Json;
          stage?: string;
          started_at?: string;
          status?: string;
          stop_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'receipt_import_attempts_file_id_fkey';
            columns: ['file_id'];
            isOneToOne: false;
            referencedRelation: 'receipt_import_files';
            referencedColumns: ['id'];
          },
        ];
      };
      receipt_import_batches: {
        Row: {
          completed_at: string | null;
          created_at: string;
          id: string;
          paid_by: string;
          status: string;
          updated_at: string;
          uploaded_by: string;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string;
          id: string;
          paid_by: string;
          status?: string;
          updated_at?: string;
          uploaded_by: string;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          paid_by?: string;
          status?: string;
          updated_at?: string;
          uploaded_by?: string;
        };
        Relationships: [];
      };
      receipt_import_files: {
        Row: {
          attempts: number;
          batch_id: string;
          content_sha256: string;
          created_at: string;
          document_kind: string | null;
          duplicate_of_file_id: string | null;
          duplicate_receipt_id: string | null;
          error_message: string | null;
          exception_kind: string | null;
          force_receipt: boolean;
          id: string;
          manual_json: Json | null;
          mime_type: string;
          original_filename: string;
          original_size_bytes: number;
          parsed_json: Json | null;
          processed_at: string | null;
          receipt_id: string | null;
          skip_duplicate_check: boolean;
          status: string;
          storage_path: string | null;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          batch_id: string;
          content_sha256: string;
          created_at?: string;
          document_kind?: string | null;
          duplicate_of_file_id?: string | null;
          duplicate_receipt_id?: string | null;
          error_message?: string | null;
          exception_kind?: string | null;
          force_receipt?: boolean;
          id: string;
          manual_json?: Json | null;
          mime_type: string;
          original_filename: string;
          original_size_bytes: number;
          parsed_json?: Json | null;
          processed_at?: string | null;
          receipt_id?: string | null;
          skip_duplicate_check?: boolean;
          status: string;
          storage_path?: string | null;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          batch_id?: string;
          content_sha256?: string;
          created_at?: string;
          document_kind?: string | null;
          duplicate_of_file_id?: string | null;
          duplicate_receipt_id?: string | null;
          error_message?: string | null;
          exception_kind?: string | null;
          force_receipt?: boolean;
          id?: string;
          manual_json?: Json | null;
          mime_type?: string;
          original_filename?: string;
          original_size_bytes?: number;
          parsed_json?: Json | null;
          processed_at?: string | null;
          receipt_id?: string | null;
          skip_duplicate_check?: boolean;
          status?: string;
          storage_path?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'receipt_import_files_batch_id_fkey';
            columns: ['batch_id'];
            isOneToOne: false;
            referencedRelation: 'receipt_import_batches';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'receipt_import_files_duplicate_of_file_id_fkey';
            columns: ['duplicate_of_file_id'];
            isOneToOne: false;
            referencedRelation: 'receipt_import_files';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'receipt_import_files_duplicate_receipt_id_fkey';
            columns: ['duplicate_receipt_id'];
            isOneToOne: false;
            referencedRelation: 'receipts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'receipt_import_files_receipt_id_fkey';
            columns: ['receipt_id'];
            isOneToOne: false;
            referencedRelation: 'receipts';
            referencedColumns: ['id'];
          },
        ];
      };
      receipts: {
        Row: {
          created_at: string;
          currency: string;
          date: string;
          fx_rate_eur: number;
          id: string;
          merchant_order_id: string | null;
          note: string | null;
          paid_by: string;
          photo_path: string | null;
          photo_url: string | null;
          raw_ocr_json: string | null;
          source: Database['public']['Enums']['receipt_source'];
          store: string;
          store_address: string | null;
          time: string | null;
          total_eur: number;
          total_orig: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          currency: string;
          date: string;
          fx_rate_eur: number;
          id: string;
          merchant_order_id?: string | null;
          note?: string | null;
          paid_by: string;
          photo_path?: string | null;
          photo_url?: string | null;
          raw_ocr_json?: string | null;
          source: Database['public']['Enums']['receipt_source'];
          store: string;
          store_address?: string | null;
          time?: string | null;
          total_eur: number;
          total_orig: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          currency?: string;
          date?: string;
          fx_rate_eur?: number;
          id?: string;
          merchant_order_id?: string | null;
          note?: string | null;
          paid_by?: string;
          photo_path?: string | null;
          photo_url?: string | null;
          raw_ocr_json?: string | null;
          source?: Database['public']['Enums']['receipt_source'];
          store?: string;
          store_address?: string | null;
          time?: string | null;
          total_eur?: number;
          total_orig?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      statement_transactions: {
        Row: {
          amount_orig: number;
          created_at: string;
          currency: string;
          date: string;
          dedup_key: string;
          id: string;
          merchant: string | null;
          paid_by: string;
          raw: string | null;
          receipt_id: string | null;
          status: string;
          suggested_category: string | null;
          time: string | null;
          updated_at: string;
        };
        Insert: {
          amount_orig: number;
          created_at?: string;
          currency: string;
          date: string;
          dedup_key: string;
          id: string;
          merchant?: string | null;
          paid_by: string;
          raw?: string | null;
          receipt_id?: string | null;
          status?: string;
          suggested_category?: string | null;
          time?: string | null;
          updated_at?: string;
        };
        Update: {
          amount_orig?: number;
          created_at?: string;
          currency?: string;
          date?: string;
          dedup_key?: string;
          id?: string;
          merchant?: string | null;
          paid_by?: string;
          raw?: string | null;
          receipt_id?: string | null;
          status?: string;
          suggested_category?: string | null;
          time?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'statement_transactions_receipt_id_fkey';
            columns: ['receipt_id'];
            isOneToOne: false;
            referencedRelation: 'receipts';
            referencedColumns: ['id'];
          },
        ];
      };
      store_aliases: {
        Row: {
          created_at: string;
          id: string;
          receipt_store: string;
          statement_name: string;
        };
        Insert: {
          created_at?: string;
          id: string;
          receipt_store: string;
          statement_name: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          receipt_store?: string;
          statement_name?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      v_stats_by_category: {
        Row: {
          category: string | null;
          items_count: number | null;
          total_eur: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'items_category_fkey';
            columns: ['category'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['name'];
          },
        ];
      };
      v_stats_by_month: {
        Row: {
          month: string | null;
          receipts_count: number | null;
          total_eur: number | null;
        };
        Relationships: [];
      };
      v_stats_by_store: {
        Row: {
          receipts_count: number | null;
          store: string | null;
          total_eur: number | null;
        };
        Relationships: [];
      };
      v_stats_by_user: {
        Row: {
          paid_by: string | null;
          receipts_count: number | null;
          total_eur: number | null;
        };
        Relationships: [];
      };
      v_stats_savings_by_month: {
        Row: {
          discounted_items_count: number | null;
          month: string | null;
          savings_eur: number | null;
        };
        Relationships: [];
      };
      v_stats_waste_by_month: {
        Row: {
          month: string | null;
          wasted_items_count: number | null;
          wasted_value_eur: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      claim_receipt_import_jobs: {
        Args: { p_limit?: number };
        Returns: {
          import_file_id: string;
          msg_id: number;
          read_count: number;
        }[];
      };
      complete_manual_receipt_import_exception: {
        Args: { p_error_message: string; p_file_id: string; p_msg_id: number };
        Returns: undefined;
      };
      complete_receipt_import_exception: {
        Args: {
          p_document_kind: string;
          p_error_message: string;
          p_exception_kind: string;
          p_file_id: string;
          p_msg_id: number;
          p_parsed_json: Json;
        };
        Returns: undefined;
      };
      create_receipt_import_batch: {
        Args: { p_batch_id: string; p_files: Json; p_paid_by: string };
        Returns: {
          duplicate_of_file_id: string;
          id: string;
          status: string;
          storage_path: string;
        }[];
      };
      discard_receipt_import_file: {
        Args: { p_file_id: string };
        Returns: undefined;
      };
      expire_stale_receipt_import_uploads: { Args: never; Returns: number };
      finalize_receipt_import: {
        Args: {
          p_file_id: string;
          p_items: Json;
          p_msg_id: number;
          p_parsed_json: Json;
          p_receipt: Json;
        };
        Returns: Json;
      };
      is_allowed_user: { Args: never; Returns: boolean };
      mark_receipt_import_upload_failed: {
        Args: { p_error_message: string; p_file_id: string };
        Returns: undefined;
      };
      queue_receipt_import_file: {
        Args: { p_file_id: string };
        Returns: undefined;
      };
      record_receipt_import_failure: {
        Args: {
          p_error_message: string;
          p_file_id: string;
          p_msg_id: number;
          p_read_count: number;
        };
        Returns: undefined;
      };
      refresh_receipt_import_batch_status: {
        Args: { p_batch_id: string };
        Returns: undefined;
      };
      requeue_receipt_import_file: {
        Args: {
          p_file_id: string;
          p_force_receipt?: boolean;
          p_skip_duplicate_check?: boolean;
        };
        Returns: undefined;
      };
      resolve_receipt_import_file: {
        Args: { p_file_id: string; p_receipt_id: string };
        Returns: undefined;
      };
      schedule_receipt_import_retry: {
        Args: {
          p_delay_seconds?: number;
          p_error_message: string;
          p_file_id: string;
          p_msg_id: number;
          p_read_count: number;
        };
        Returns: undefined;
      };
      submit_receipt_import_json: {
        Args: { p_file_id: string; p_manual_json: Json };
        Returns: undefined;
      };
    };
    Enums: {
      product_unit: 'pcs' | 'g' | 'kg' | 'ml' | 'l';
      receipt_source: 'photo' | 'manual' | 'edit' | 'manual-json' | 'statement';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      product_unit: ['pcs', 'g', 'kg', 'ml', 'l'],
      receipt_source: ['photo', 'manual', 'edit', 'manual-json', 'statement'],
    },
  },
} as const;
