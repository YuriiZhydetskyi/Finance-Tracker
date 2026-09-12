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
          aliases: string[];
          group_name: string;
          name: string;
          name_de: string | null;
          name_en: string | null;
        };
        Insert: {
          aliases?: string[];
          group_name: string;
          name: string;
          name_de?: string | null;
          name_en?: string | null;
        };
        Update: {
          aliases?: string[];
          group_name?: string;
          name?: string;
          name_de?: string | null;
          name_en?: string | null;
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
          product_family_id: string | null;
          product_id: string | null;
          product_image_url: string | null;
          product_name: string;
          product_url: string | null;
          product_variant_id: string | null;
          qty: number;
          raw_product_name: string;
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
          product_family_id?: string | null;
          product_id?: string | null;
          product_image_url?: string | null;
          product_name: string;
          product_url?: string | null;
          product_variant_id?: string | null;
          qty: number;
          raw_product_name: string;
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
          product_family_id?: string | null;
          product_id?: string | null;
          product_image_url?: string | null;
          product_name?: string;
          product_url?: string | null;
          product_variant_id?: string | null;
          qty?: number;
          raw_product_name?: string;
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
            foreignKeyName: 'items_product_family_id_fkey';
            columns: ['product_family_id'];
            isOneToOne: false;
            referencedRelation: 'product_families';
            referencedColumns: ['id'];
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
          {
            foreignKeyName: 'items_variant_family_fkey';
            columns: ['product_variant_id', 'product_family_id'];
            isOneToOne: false;
            referencedRelation: 'product_variants';
            referencedColumns: ['id', 'family_id'];
          },
        ];
      };
      packaged_product_photos: {
        Row: {
          byte_size: number | null;
          content_type: string | null;
          created_at: string;
          id: string;
          kind: string;
          note: string | null;
          packaged_product_id: string;
          sort_order: number;
          storage_path: string;
          updated_at: string;
        };
        Insert: {
          byte_size?: number | null;
          content_type?: string | null;
          created_at?: string;
          id: string;
          kind?: string;
          note?: string | null;
          packaged_product_id: string;
          sort_order?: number;
          storage_path: string;
          updated_at?: string;
        };
        Update: {
          byte_size?: number | null;
          content_type?: string | null;
          created_at?: string;
          id?: string;
          kind?: string;
          note?: string | null;
          packaged_product_id?: string;
          sort_order?: number;
          storage_path?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'packaged_product_photos_packaged_product_id_fkey';
            columns: ['packaged_product_id'];
            isOneToOne: false;
            referencedRelation: 'packaged_products';
            referencedColumns: ['id'];
          },
        ];
      };
      packaged_products: {
        Row: {
          allergen_traces: Database['public']['Enums']['eu_allergen'][];
          allergens: Database['public']['Enums']['eu_allergen'][];
          barcode: string | null;
          brand: string | null;
          carbohydrate_g: number | null;
          category: string;
          created_at: string;
          energy_kcal: number | null;
          energy_kj: number | null;
          fat_g: number | null;
          fibre_g: number | null;
          id: string;
          import_source: string;
          ingredients_text: string | null;
          is_organic: boolean | null;
          name: string;
          notes: string | null;
          nutri_score: string | null;
          nutrition_basis: Database['public']['Enums']['nutrition_basis'] | null;
          package_count: number | null;
          package_size: number | null;
          package_unit: Database['public']['Enums']['product_unit'] | null;
          product_family_id: string | null;
          product_variant_id: string | null;
          protein_g: number | null;
          raw_import_json: Json | null;
          salt_g: number | null;
          saturated_fat_g: number | null;
          serving_size: number | null;
          sugars_g: number | null;
          updated_at: string;
        };
        Insert: {
          allergen_traces?: Database['public']['Enums']['eu_allergen'][];
          allergens?: Database['public']['Enums']['eu_allergen'][];
          barcode?: string | null;
          brand?: string | null;
          carbohydrate_g?: number | null;
          category: string;
          created_at?: string;
          energy_kcal?: number | null;
          energy_kj?: number | null;
          fat_g?: number | null;
          fibre_g?: number | null;
          id: string;
          import_source?: string;
          ingredients_text?: string | null;
          is_organic?: boolean | null;
          name: string;
          notes?: string | null;
          nutri_score?: string | null;
          nutrition_basis?: Database['public']['Enums']['nutrition_basis'] | null;
          package_count?: number | null;
          package_size?: number | null;
          package_unit?: Database['public']['Enums']['product_unit'] | null;
          product_family_id?: string | null;
          product_variant_id?: string | null;
          protein_g?: number | null;
          raw_import_json?: Json | null;
          salt_g?: number | null;
          saturated_fat_g?: number | null;
          serving_size?: number | null;
          sugars_g?: number | null;
          updated_at?: string;
        };
        Update: {
          allergen_traces?: Database['public']['Enums']['eu_allergen'][];
          allergens?: Database['public']['Enums']['eu_allergen'][];
          barcode?: string | null;
          brand?: string | null;
          carbohydrate_g?: number | null;
          category?: string;
          created_at?: string;
          energy_kcal?: number | null;
          energy_kj?: number | null;
          fat_g?: number | null;
          fibre_g?: number | null;
          id?: string;
          import_source?: string;
          ingredients_text?: string | null;
          is_organic?: boolean | null;
          name?: string;
          notes?: string | null;
          nutri_score?: string | null;
          nutrition_basis?: Database['public']['Enums']['nutrition_basis'] | null;
          package_count?: number | null;
          package_size?: number | null;
          package_unit?: Database['public']['Enums']['product_unit'] | null;
          product_family_id?: string | null;
          product_variant_id?: string | null;
          protein_g?: number | null;
          raw_import_json?: Json | null;
          salt_g?: number | null;
          saturated_fat_g?: number | null;
          serving_size?: number | null;
          sugars_g?: number | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'packaged_products_category_fkey';
            columns: ['category'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['name'];
          },
          {
            foreignKeyName: 'packaged_products_product_family_id_fkey';
            columns: ['product_family_id'];
            isOneToOne: false;
            referencedRelation: 'product_families';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'packaged_products_variant_family_fkey';
            columns: ['product_variant_id', 'product_family_id'];
            isOneToOne: false;
            referencedRelation: 'product_variants';
            referencedColumns: ['id', 'family_id'];
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
      product_families: {
        Row: {
          aliases: string[];
          id: string;
          name_de: string;
          name_en: string;
          name_uk: string;
        };
        Insert: {
          aliases?: string[];
          id: string;
          name_de: string;
          name_en: string;
          name_uk: string;
        };
        Update: {
          aliases?: string[];
          id?: string;
          name_de?: string;
          name_en?: string;
          name_uk?: string;
        };
        Relationships: [];
      };
      product_match_rules: {
        Row: {
          category: string;
          created_at: string;
          product_family_id: string | null;
          product_id: string;
          product_name: string;
          product_variant_id: string | null;
          raw_product_name_key: string;
          store_key: string;
          updated_at: string;
        };
        Insert: {
          category: string;
          created_at?: string;
          product_family_id?: string | null;
          product_id: string;
          product_name: string;
          product_variant_id?: string | null;
          raw_product_name_key: string;
          store_key: string;
          updated_at?: string;
        };
        Update: {
          category?: string;
          created_at?: string;
          product_family_id?: string | null;
          product_id?: string;
          product_name?: string;
          product_variant_id?: string | null;
          raw_product_name_key?: string;
          store_key?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'product_match_rules_category_fkey';
            columns: ['category'];
            isOneToOne: false;
            referencedRelation: 'categories';
            referencedColumns: ['name'];
          },
          {
            foreignKeyName: 'product_match_rules_product_family_id_fkey';
            columns: ['product_family_id'];
            isOneToOne: false;
            referencedRelation: 'product_families';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_match_rules_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_match_rules_variant_family_fkey';
            columns: ['product_variant_id', 'product_family_id'];
            isOneToOne: false;
            referencedRelation: 'product_variants';
            referencedColumns: ['id', 'family_id'];
          },
        ];
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
      product_variants: {
        Row: {
          aliases: string[];
          family_id: string;
          id: string;
          name_de: string;
          name_en: string;
          name_uk: string;
        };
        Insert: {
          aliases?: string[];
          family_id: string;
          id: string;
          name_de: string;
          name_en: string;
          name_uk: string;
        };
        Update: {
          aliases?: string[];
          family_id?: string;
          id?: string;
          name_de?: string;
          name_en?: string;
          name_uk?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'product_variants_family_id_fkey';
            columns: ['family_id'];
            isOneToOne: false;
            referencedRelation: 'product_families';
            referencedColumns: ['id'];
          },
        ];
      };
      products: {
        Row: {
          brand: string | null;
          category: string;
          created_at: string;
          id: string;
          is_organic: boolean | null;
          name: string;
          notes: string | null;
          packaged_product_id: string | null;
          packaging_not_applicable: boolean;
          product_family_id: string | null;
          product_variant_id: string | null;
          store: string;
          store_product_code: string | null;
          unit: Database['public']['Enums']['product_unit'] | null;
          unit_size: number | null;
          updated_at: string;
        };
        Insert: {
          brand?: string | null;
          category: string;
          created_at?: string;
          id: string;
          is_organic?: boolean | null;
          name: string;
          notes?: string | null;
          packaged_product_id?: string | null;
          packaging_not_applicable?: boolean;
          product_family_id?: string | null;
          product_variant_id?: string | null;
          store?: string;
          store_product_code?: string | null;
          unit?: Database['public']['Enums']['product_unit'] | null;
          unit_size?: number | null;
          updated_at?: string;
        };
        Update: {
          brand?: string | null;
          category?: string;
          created_at?: string;
          id?: string;
          is_organic?: boolean | null;
          name?: string;
          notes?: string | null;
          packaged_product_id?: string | null;
          packaging_not_applicable?: boolean;
          product_family_id?: string | null;
          product_variant_id?: string | null;
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
          {
            foreignKeyName: 'products_packaged_product_id_fkey';
            columns: ['packaged_product_id'];
            isOneToOne: false;
            referencedRelation: 'packaged_products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_product_family_id_fkey';
            columns: ['product_family_id'];
            isOneToOne: false;
            referencedRelation: 'product_families';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'products_variant_family_fkey';
            columns: ['product_variant_id', 'product_family_id'];
            isOneToOne: false;
            referencedRelation: 'product_variants';
            referencedColumns: ['id', 'family_id'];
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
      correct_purchase_classification: {
        Args: {
          p_category: string;
          p_item_id: string;
          p_product_family_id?: string;
          p_product_id: string;
          p_product_name: string;
          p_product_variant_id?: string;
          p_remember_rule?: boolean;
        };
        Returns: {
          category: string;
          consumed_by: string;
          created_at: string;
          discount_orig: number;
          id: string;
          note: string | null;
          product_family_id: string | null;
          product_id: string | null;
          product_image_url: string | null;
          product_name: string;
          product_url: string | null;
          product_variant_id: string | null;
          qty: number;
          raw_product_name: string;
          receipt_id: string;
          store_product_code: string | null;
          total_eur: number;
          total_orig: number;
          unit_price_orig: number;
          updated_at: string;
          wasted_at: string | null;
          wasted_qty: number;
        };
        SetofOptions: {
          from: '*';
          to: 'items';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_manual_receipt_import_batch: {
        Args: { p_batch_id: string; p_paid_by: string; p_receipts: Json };
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
      finalize_pasted_json_import: {
        Args: {
          p_file_id: string;
          p_items: Json;
          p_msg_id: number;
          p_parsed_json: Json;
          p_receipt: Json;
        };
        Returns: Json;
      };
      finalize_pasted_json_import_review_duplicate: {
        Args: {
          p_file_id: string;
          p_items: Json;
          p_msg_id: number;
          p_parsed_json: Json;
          p_receipt: Json;
        };
        Returns: Json;
      };
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
      normalize_product_match_key: {
        Args: { p_value: string };
        Returns: string;
      };
      normalize_product_search: { Args: { p_value: string }; Returns: string };
      packaged_product_store_labels: {
        Args: { p_packaged_product_id: string };
        Returns: {
          first_purchased_on: string;
          last_currency: string;
          last_price_net: number;
          last_price_orig: number;
          last_purchased_on: string;
          product_id: string;
          product_name: string;
          purchases_count: number;
          receipt_labels: string[];
          store: string;
          store_product_code: string;
        }[];
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
      search_packaging_candidates: {
        Args: {
          p_categories?: string[];
          p_date_from?: string;
          p_date_to?: string;
          p_limit?: number;
          p_offset?: number;
          p_query?: string;
          p_stores?: string[];
        };
        Returns: {
          brand: string;
          category: string;
          group_key: string;
          group_purchases_count: number;
          is_organic: boolean;
          last_currency: string;
          last_price_orig: number;
          last_purchased_on: string;
          product_family_id: string;
          product_id: string;
          product_name: string;
          product_variant_id: string;
          purchases_count: number;
          receipt_labels: string[];
          store: string;
          store_product_code: string;
          total_eur: number;
          total_qty: number;
        }[];
      };
      search_waste_items: {
        Args: { p_query?: string };
        Returns: {
          category: string;
          consumed_by: string;
          created_at: string;
          discount_orig: number;
          id: string;
          note: string | null;
          product_family_id: string | null;
          product_id: string | null;
          product_image_url: string | null;
          product_name: string;
          product_url: string | null;
          product_variant_id: string | null;
          qty: number;
          raw_product_name: string;
          receipt_id: string;
          store_product_code: string | null;
          total_eur: number;
          total_orig: number;
          unit_price_orig: number;
          updated_at: string;
          wasted_at: string | null;
          wasted_qty: number;
        }[];
        SetofOptions: {
          from: '*';
          to: 'items';
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      stats_by_category: {
        Args: {
          p_categories?: string[];
          p_date_from?: string;
          p_date_to?: string;
          p_stores?: string[];
        };
        Returns: {
          category: string;
          items_count: number;
          total_eur: number;
        }[];
      };
      stats_by_month: {
        Args: {
          p_categories?: string[];
          p_date_from?: string;
          p_date_to?: string;
          p_stores?: string[];
        };
        Returns: {
          month: string;
          receipts_count: number;
          total_eur: number;
        }[];
      };
      stats_by_store: {
        Args: {
          p_categories?: string[];
          p_date_from?: string;
          p_date_to?: string;
          p_limit?: number;
          p_stores?: string[];
        };
        Returns: {
          receipts_count: number;
          store: string;
          total_eur: number;
        }[];
      };
      stats_by_user: {
        Args: {
          p_categories?: string[];
          p_date_from?: string;
          p_date_to?: string;
          p_stores?: string[];
        };
        Returns: {
          paid_by: string;
          receipts_count: number;
          total_eur: number;
        }[];
      };
      stats_filter_options: {
        Args: never;
        Returns: {
          categories: string[];
          stores: string[];
        }[];
      };
      stats_savings_by_month: {
        Args: {
          p_categories?: string[];
          p_date_from?: string;
          p_date_to?: string;
          p_stores?: string[];
        };
        Returns: {
          discounted_items_count: number;
          month: string;
          savings_eur: number;
        }[];
      };
      stats_waste_by_month: {
        Args: {
          p_categories?: string[];
          p_date_from?: string;
          p_date_to?: string;
          p_stores?: string[];
        };
        Returns: {
          month: string;
          wasted_items_count: number;
          wasted_value_eur: number;
        }[];
      };
      submit_receipt_import_json: {
        Args: { p_file_id: string; p_manual_json: Json };
        Returns: undefined;
      };
    };
    Enums: {
      eu_allergen:
        | 'gluten'
        | 'crustaceans'
        | 'eggs'
        | 'fish'
        | 'peanuts'
        | 'soybeans'
        | 'milk'
        | 'nuts'
        | 'celery'
        | 'mustard'
        | 'sesame'
        | 'sulphites'
        | 'lupin'
        | 'molluscs';
      nutrition_basis: 'per_100_g' | 'per_100_ml';
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
      eu_allergen: [
        'gluten',
        'crustaceans',
        'eggs',
        'fish',
        'peanuts',
        'soybeans',
        'milk',
        'nuts',
        'celery',
        'mustard',
        'sesame',
        'sulphites',
        'lupin',
        'molluscs',
      ],
      nutrition_basis: ['per_100_g', 'per_100_ml'],
      product_unit: ['pcs', 'g', 'kg', 'ml', 'l'],
      receipt_source: ['photo', 'manual', 'edit', 'manual-json', 'statement'],
    },
  },
} as const;
