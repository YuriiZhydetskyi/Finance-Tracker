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
          product_name: string;
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
          product_name: string;
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
          product_name?: string;
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
      receipts: {
        Row: {
          created_at: string;
          currency: string;
          date: string;
          fx_rate_eur: number;
          id: string;
          note: string | null;
          paid_by: string;
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
          note?: string | null;
          paid_by: string;
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
          note?: string | null;
          paid_by?: string;
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
      is_allowed_user: { Args: never; Returns: boolean };
    };
    Enums: {
      product_unit: 'pcs' | 'g' | 'kg' | 'ml' | 'l';
      receipt_source: 'photo' | 'manual' | 'edit';
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
      receipt_source: ['photo', 'manual', 'edit'],
    },
  },
} as const;
