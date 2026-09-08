import type { Database as GeneratedDatabase } from './database.types';

type GeneratedPublic = GeneratedDatabase['public'];
type GeneratedItems = GeneratedPublic['Tables']['items'];

type ItemsWithRawLabel = Omit<GeneratedItems, 'Row' | 'Insert' | 'Update'> & {
  Row: GeneratedItems['Row'] & { raw_product_name: string };
  Insert: GeneratedItems['Insert'] & { raw_product_name: string };
  Update: GeneratedItems['Update'] & { raw_product_name?: string };
};

type ProductMatchRules = {
  Row: {
    store_key: string;
    raw_product_name_key: string;
    product_id: string;
    product_name: string;
    category: string;
    product_family_id: string | null;
    product_variant_id: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    store_key: string;
    raw_product_name_key: string;
    product_id: string;
    product_name: string;
    category: string;
    product_family_id?: string | null;
    product_variant_id?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Update: {
    store_key?: string;
    raw_product_name_key?: string;
    product_id?: string;
    product_name?: string;
    category?: string;
    product_family_id?: string | null;
    product_variant_id?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Relationships: [
    {
      foreignKeyName: 'product_match_rules_product_id_fkey';
      columns: ['product_id'];
      isOneToOne: false;
      referencedRelation: 'products';
      referencedColumns: ['id'];
    },
  ];
};

/**
 * Temporary additive overlay for a migration that has not yet been deployed,
 * so its canonical generated type cannot exist. Delete this file after the
 * next `supabase gen types typescript --linked` includes this schema.
 */
export type DatabaseWithPurchaseCorrections = Omit<GeneratedDatabase, 'public'> & {
  public: Omit<GeneratedPublic, 'Tables' | 'Functions'> & {
    Tables: Omit<GeneratedPublic['Tables'], 'items'> & {
      items: ItemsWithRawLabel;
      product_match_rules: ProductMatchRules;
    };
    Functions: GeneratedPublic['Functions'] & {
      correct_purchase_classification: {
        Args: {
          p_item_id: string;
          p_product_id: string;
          p_product_name: string;
          p_category: string;
          p_product_family_id?: string | null;
          p_product_variant_id?: string | null;
          p_remember_rule?: boolean;
        };
        Returns: ItemsWithRawLabel['Row'];
      };
    };
  };
};
