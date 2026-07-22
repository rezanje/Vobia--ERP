// ponytail: hand-written to mirror Supabase codegen shape. `supabase gen types`
// needs a container runtime (Docker/podman) which isn't available here, and the
// Supabase MCP has no access to this project. Regenerate with `npm run gen:types`
// (needs Docker) or the MCP once either is available — keep this in sync with
// supabase/migrations until then.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      tenants: {
        Row: { id: string; name: string; created_at: string }
        Insert: { id?: string; name: string; created_at?: string }
        Update: { id?: string; name?: string; created_at?: string }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          tenant_id: string
          role: string
          full_name: string | null
          created_at: string
        }
        Insert: {
          id: string
          tenant_id: string
          role?: string
          full_name?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          role?: string
          full_name?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      styles: {
        Row: { id: string; tenant_id: string; code: string; name: string; collection: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; code: string; name: string; collection?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; code?: string; name?: string; collection?: string | null; created_at?: string }
        Relationships: []
      }
      colorways: {
        Row: { id: string; tenant_id: string; style_id: string; color_name: string; color_code: string; created_at: string }
        Insert: { id?: string; tenant_id: string; style_id: string; color_name: string; color_code: string; created_at?: string }
        Update: { id?: string; tenant_id?: string; style_id?: string; color_name?: string; color_code?: string; created_at?: string }
        Relationships: []
      }
      skus: {
        Row: { id: string; tenant_id: string; colorway_id: string; size: string; sku_code: string; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id: string; colorway_id: string; size: string; sku_code: string; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; colorway_id?: string; size?: string; sku_code?: string; active?: boolean; created_at?: string }
        Relationships: []
      }
      locations: {
        Row: { id: string; tenant_id: string; name: string; is_default: boolean; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id?: string; name: string; is_default?: boolean; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; is_default?: boolean; active?: boolean; created_at?: string }
        Relationships: []
      }
      materials: {
        Row: { id: string; tenant_id: string; code: string; name: string; category: string; uom: string; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id?: string; code: string; name: string; category: string; uom: string; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; code?: string; name?: string; category?: string; uom?: string; active?: boolean; created_at?: string }
        Relationships: []
      }
      material_ledger: {
        Row: { id: string; tenant_id: string; material_id: string; location_id: string; qty: number; movement_type: string; reason: string | null; ref_type: string | null; ref_id: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; material_id: string; location_id: string; qty: number; movement_type: string; reason?: string | null; ref_type?: string | null; ref_id?: string | null; created_by?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; material_id?: string; location_id?: string; qty?: number; movement_type?: string; reason?: string | null; ref_type?: string | null; ref_id?: string | null; created_by?: string | null; created_at?: string }
        Relationships: []
      }
      stock_ledger: {
        Row: { id: string; tenant_id: string; sku_id: string; location_id: string; qty: number; movement_type: string; reason: string | null; ref_type: string | null; ref_id: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; sku_id: string; location_id: string; qty: number; movement_type: string; reason?: string | null; ref_type?: string | null; ref_id?: string | null; created_by?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; sku_id?: string; location_id?: string; qty?: number; movement_type?: string; reason?: string | null; ref_type?: string | null; ref_id?: string | null; created_by?: string | null; created_at?: string }
        Relationships: []
      }
      vendors: {
        Row: { id: string; tenant_id: string; name: string; contact: string | null; active: boolean; created_at: string; moq: number | null }
        Insert: { id?: string; tenant_id?: string; name: string; contact?: string | null; active?: boolean; created_at?: string; moq?: number | null }
        Update: { id?: string; tenant_id?: string; name?: string; contact?: string | null; active?: boolean; created_at?: string; moq?: number | null }
        Relationships: []
      }
      production_orders: {
        Row: { id: string; tenant_id: string; code: string; style_id: string; vendor_id: string; stage: string; deadline: string | null; notes: string | null; created_at: string; doc_status: string; approved_by: string | null; approved_at: string | null; ppo_id: string | null }
        Insert: { id?: string; tenant_id: string; code: string; style_id: string; vendor_id: string; stage?: string; deadline?: string | null; notes?: string | null; created_at?: string; doc_status?: string; approved_by?: string | null; approved_at?: string | null; ppo_id?: string | null }
        Update: { id?: string; tenant_id?: string; code?: string; style_id?: string; vendor_id?: string; stage?: string; deadline?: string | null; notes?: string | null; created_at?: string; doc_status?: string; approved_by?: string | null; approved_at?: string | null; ppo_id?: string | null }
        Relationships: []
      }
      prod_lines: {
        Row: { id: string; tenant_id: string; po_id: string; sku_id: string; qty_ordered: number; qty_received: number; reject_count: number; created_at: string }
        Insert: { id?: string; tenant_id: string; po_id: string; sku_id: string; qty_ordered: number; qty_received?: number; reject_count?: number; created_at?: string }
        Update: { id?: string; tenant_id?: string; po_id?: string; sku_id?: string; qty_ordered?: number; qty_received?: number; reject_count?: number; created_at?: string }
        Relationships: []
      }
      cost_entries: {
        Row: { id: string; tenant_id: string; po_id: string; cost_type: string; amount: number; note: string | null; created_at: string }
        Insert: { id?: string; tenant_id?: string; po_id: string; cost_type: string; amount: number; note?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; po_id?: string; cost_type?: string; amount?: number; note?: string | null; created_at?: string }
        Relationships: []
      }
      channels: {
        Row: { id: string; tenant_id: string; name: string; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id?: string; name: string; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; active?: boolean; created_at?: string }
        Relationships: []
      }
      orders: {
        Row: { id: string; tenant_id: string; code: string; channel_id: string; order_date: string; customer: string | null; notes: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; code: string; channel_id: string; order_date?: string; customer?: string | null; notes?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; code?: string; channel_id?: string; order_date?: string; customer?: string | null; notes?: string | null; created_at?: string }
        Relationships: []
      }
      order_lines: {
        Row: { id: string; tenant_id: string; order_id: string; sku_id: string; qty: number; unit_price: number; created_at: string }
        Insert: { id?: string; tenant_id: string; order_id: string; sku_id: string; qty: number; unit_price?: number; created_at?: string }
        Update: { id?: string; tenant_id?: string; order_id?: string; sku_id?: string; qty?: number; unit_price?: number; created_at?: string }
        Relationships: []
      }
      purchase_orders: {
        Row: { id: string; tenant_id: string; code: string; vendor_id: string; location_id: string; order_date: string; status: string; notes: string | null; created_at: string; doc_status: string; approved_by: string | null; approved_at: string | null; ppo_id: string | null; po_type: string; amount: number }
        Insert: { id?: string; tenant_id?: string; code: string; vendor_id: string; location_id: string; order_date?: string; status?: string; notes?: string | null; created_at?: string; doc_status?: string; approved_by?: string | null; approved_at?: string | null; ppo_id?: string | null; po_type?: string; amount?: number }
        Update: { id?: string; tenant_id?: string; code?: string; vendor_id?: string; location_id?: string; order_date?: string; status?: string; notes?: string | null; created_at?: string; doc_status?: string; approved_by?: string | null; approved_at?: string | null; ppo_id?: string | null; po_type?: string; amount?: number }
        Relationships: []
      }
      purchase_lines: {
        Row: { id: string; tenant_id: string; po_id: string; material_id: string; qty_ordered: number; unit_price: number; qty_received: number; created_at: string }
        Insert: { id?: string; tenant_id: string; po_id: string; material_id: string; qty_ordered: number; unit_price?: number; qty_received?: number; created_at?: string }
        Update: { id?: string; tenant_id?: string; po_id?: string; material_id?: string; qty_ordered?: number; unit_price?: number; qty_received?: number; created_at?: string }
        Relationships: []
      }
      bom_lines: {
        Row: { id: string; tenant_id: string; style_id: string; material_id: string; qty_per_unit: number; created_at: string }
        Insert: { id?: string; tenant_id?: string; style_id: string; material_id: string; qty_per_unit: number; created_at?: string }
        Update: { id?: string; tenant_id?: string; style_id?: string; material_id?: string; qty_per_unit?: number; created_at?: string }
        Relationships: []
      }
      returns: {
        Row: { id: string; tenant_id: string; code: string; order_id: string; return_date: string; reason: string | null; notes: string | null; created_at: string }
        Insert: { id?: string; tenant_id?: string; code: string; order_id: string; return_date?: string; reason?: string | null; notes?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; code?: string; order_id?: string; return_date?: string; reason?: string | null; notes?: string | null; created_at?: string }
        Relationships: []
      }
      return_lines: {
        Row: { id: string; tenant_id: string; return_id: string; sku_id: string; qty: number; created_at: string }
        Insert: { id?: string; tenant_id: string; return_id: string; sku_id: string; qty: number; created_at?: string }
        Update: { id?: string; tenant_id?: string; return_id?: string; sku_id?: string; qty?: number; created_at?: string }
        Relationships: []
      }
      accounts: {
        Row: { id: string; tenant_id: string; code: string; name: string; type: string; normal_balance: string; is_contra: boolean; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id?: string; code: string; name: string; type: string; normal_balance: string; is_contra?: boolean; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; code?: string; name?: string; type?: string; normal_balance?: string; is_contra?: boolean; active?: boolean; created_at?: string }
        Relationships: []
      }
      journals: {
        Row: { id: string; tenant_id: string; journal_date: string; memo: string | null; source_type: string | null; source_id: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; journal_date?: string; memo?: string | null; source_type?: string | null; source_id?: string | null; created_by?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; journal_date?: string; memo?: string | null; source_type?: string | null; source_id?: string | null; created_by?: string | null; created_at?: string }
        Relationships: []
      }
      journal_lines: {
        Row: { id: string; tenant_id: string; journal_id: string; account_id: string; debit: number; credit: number; memo: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; journal_id: string; account_id: string; debit?: number; credit?: number; memo?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; journal_id?: string; account_id?: string; debit?: number; credit?: number; memo?: string | null; created_at?: string }
        Relationships: []
      }
      employees: {
        Row: { id: string; tenant_id: string; name: string; position: string | null; placement: string | null; join_date: string | null; base_salary: number; bank_account: string | null; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id?: string; name: string; position?: string | null; placement?: string | null; join_date?: string | null; base_salary?: number; bank_account?: string | null; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; position?: string | null; placement?: string | null; join_date?: string | null; base_salary?: number; bank_account?: string | null; active?: boolean; created_at?: string }
        Relationships: []
      }
      pay_components: {
        Row: { id: string; tenant_id: string; name: string; kind: string; calc: string; value: number; is_tax: boolean; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id?: string; name: string; kind: string; calc: string; value?: number; is_tax?: boolean; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; kind?: string; calc?: string; value?: number; is_tax?: boolean; active?: boolean; created_at?: string }
        Relationships: []
      }
      payroll_runs: {
        Row: { id: string; tenant_id: string; period: string; status: string; journal_id: string | null; posted_at: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; period: string; status?: string; journal_id?: string | null; posted_at?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; period?: string; status?: string; journal_id?: string | null; posted_at?: string | null; created_at?: string }
        Relationships: []
      }
      payslips: {
        Row: { id: string; tenant_id: string; run_id: string; employee_id: string; base_salary: number; tunjangan_total: number; overtime: number; deduction_total: number; tax_total: number; gross: number; net: number; created_at: string }
        Insert: { id?: string; tenant_id: string; run_id: string; employee_id: string; base_salary?: number; tunjangan_total?: number; overtime?: number; deduction_total?: number; tax_total?: number; created_at?: string }
        Update: { id?: string; tenant_id?: string; run_id?: string; employee_id?: string; base_salary?: number; tunjangan_total?: number; overtime?: number; deduction_total?: number; tax_total?: number; created_at?: string }
        Relationships: []
      }
      payslip_lines: {
        Row: { id: string; tenant_id: string; payslip_id: string; label: string; kind: string; amount: number; created_at: string }
        Insert: { id?: string; tenant_id: string; payslip_id: string; label: string; kind: string; amount: number; created_at?: string }
        Update: { id?: string; tenant_id?: string; payslip_id?: string; label?: string; kind?: string; amount?: number; created_at?: string }
        Relationships: []
      }
      forecasts: {
        Row: { id: string; tenant_id: string; kind: string; period: string; notes: string | null; created_at: string }
        Insert: { id?: string; tenant_id?: string; kind: string; period: string; notes?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; kind?: string; period?: string; notes?: string | null; created_at?: string }
        Relationships: []
      }
      forecast_lines: {
        Row: { id: string; tenant_id: string; forecast_id: string; style_id: string; qty: number; ito: number | null; stock_ratio: number | null }
        Insert: { id?: string; tenant_id: string; forecast_id: string; style_id: string; qty: number; ito?: number | null; stock_ratio?: number | null }
        Update: { id?: string; tenant_id?: string; forecast_id?: string; style_id?: string; qty?: number; ito?: number | null; stock_ratio?: number | null }
        Relationships: []
      }
      new_products: {
        Row: { id: string; tenant_id: string; name: string; style_id: string | null; rnd_status: string; mkt_status: string; agreed_qty: number | null; notes: string | null; created_at: string }
        Insert: { id?: string; tenant_id?: string; name: string; style_id?: string | null; rnd_status?: string; mkt_status?: string; agreed_qty?: number | null; notes?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; style_id?: string | null; rnd_status?: string; mkt_status?: string; agreed_qty?: number | null; notes?: string | null; created_at?: string }
        Relationships: []
      }
      projections: {
        Row: { id: string; tenant_id: string; period: string; status: string; locked_at: string | null; created_at: string }
        Insert: { id?: string; tenant_id?: string; period: string; status?: string; locked_at?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; period?: string; status?: string; locked_at?: string | null; created_at?: string }
        Relationships: []
      }
      projection_lines: {
        Row: { id: string; tenant_id: string; projection_id: string; style_id: string; qty: number; kind: string; new_product_id: string | null }
        Insert: { id?: string; tenant_id: string; projection_id: string; style_id: string; qty: number; kind?: string; new_product_id?: string | null }
        Update: { id?: string; tenant_id?: string; projection_id?: string; style_id?: string; qty?: number; kind?: string; new_product_id?: string | null }
        Relationships: []
      }
      pcb: {
        Row: { id: string; tenant_id: string; code: string; quarter: string; projection_id: string; status: string; created_at: string }
        Insert: { id?: string; tenant_id?: string; code: string; quarter: string; projection_id: string; status?: string; created_at?: string }
        Update: { id?: string; tenant_id?: string; code?: string; quarter?: string; projection_id?: string; status?: string; created_at?: string }
        Relationships: []
      }
      pcb_lines: {
        Row: { id: string; tenant_id: string; pcb_id: string; style_id: string; target_sales: number; ending_stock: number; supply_qty: number; unit_cost: number; total: number }
        Insert: { id?: string; tenant_id: string; pcb_id: string; style_id: string; target_sales: number; ending_stock?: number; unit_cost?: number }
        Update: { id?: string; tenant_id?: string; pcb_id?: string; style_id?: string; target_sales?: number; ending_stock?: number; unit_cost?: number }
        Relationships: []
      }
      ppo: {
        Row: { id: string; tenant_id: string; code: string; pcb_id: string; style_id: string; scheme: string; qty: number; status: string; notes: string | null; created_at: string }
        Insert: { id?: string; tenant_id?: string; code: string; pcb_id: string; style_id: string; scheme: string; qty: number; status?: string; notes?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; code?: string; pcb_id?: string; style_id?: string; scheme?: string; qty?: number; status?: string; notes?: string | null; created_at?: string }
        Relationships: []
      }
      po_payments: {
        Row: { id: string; tenant_id: string; po_id: string; kind: string; amount: number; status: string; paid_at: string | null; created_at: string }
        Insert: { id?: string; tenant_id?: string; po_id: string; kind: string; amount: number; status?: string; paid_at?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; po_id?: string; kind?: string; amount?: number; status?: string; paid_at?: string | null; created_at?: string }
        Relationships: []
      }
      planning_params: {
        Row: { tenant_id: string; cover_months: number; selling_days: number; net_rate: number; lead_time_months: number; updated_at: string }
        Insert: { tenant_id?: string; cover_months?: number; selling_days?: number; net_rate?: number; lead_time_months?: number; updated_at?: string }
        Update: { tenant_id?: string; cover_months?: number; selling_days?: number; net_rate?: number; lead_time_months?: number; updated_at?: string }
        Relationships: []
      }
      demand_plan: {
        Row: { id: string; tenant_id: string; sku_id: string; month: string; qty: number; source: string; updated_at: string }
        Insert: { id?: string; tenant_id?: string; sku_id: string; month: string; qty: number; source?: string; updated_at?: string }
        Update: { id?: string; tenant_id?: string; sku_id?: string; month?: string; qty?: number; source?: string; updated_at?: string }
        Relationships: []
      }
    }
    Views: {
      style_summary: {
        Row: { id: string; tenant_id: string; code: string; name: string; collection: string | null; created_at: string; colorway_count: number; sku_count: number }
        Relationships: []
      }
      stock_balances: {
        Row: { sku_id: string | null; tenant_id: string | null; balance: number | null }
        Relationships: []
      }
      stock_balances_by_location: {
        Row: { sku_id: string | null; location_id: string | null; tenant_id: string | null; balance: number | null }
        Relationships: []
      }
      material_balances_by_location: {
        Row: { material_id: string | null; location_id: string | null; tenant_id: string | null; balance: number | null }
        Relationships: []
      }
      material_balances: {
        Row: { material_id: string | null; tenant_id: string | null; balance: number | null }
        Relationships: []
      }
      sku_hpp: {
        Row: { tenant_id: string | null; sku_id: string | null; hpp: number | null; costed_units: number | null }
        Relationships: []
      }
      account_balances: {
        Row: { tenant_id: string | null; account_id: string | null; account_code: string | null; account_name: string | null; account_type: string | null; normal_balance: string | null; is_contra: boolean | null; total_debit: number | null; total_credit: number | null; balance: number | null }
        Relationships: []
      }
      ledger_entries: {
        Row: { tenant_id: string | null; journal_id: string | null; journal_date: string | null; journal_memo: string | null; source_type: string | null; account_id: string | null; account_code: string | null; account_name: string | null; account_type: string | null; normal_balance: string | null; is_contra: boolean | null; debit: number | null; credit: number | null; line_memo: string | null }
        Relationships: []
      }
    }
    Functions: {
      create_style_with_skus: {
        Args: {
          p_code: string; p_name: string; p_collection: string
          p_colorways: Json; p_sizes: string[]; p_overrides: Json
        }
        Returns: string
      }
      record_movement: {
        Args: { p_sku_id: string; p_qty: number; p_movement_type: string; p_reason?: string; p_ref_type?: string; p_ref_id?: string; p_location_id?: string }
        Returns: string
      }
      record_material_movement: {
        Args: { p_material_id: string; p_qty: number; p_movement_type: string; p_reason?: string; p_ref_type?: string; p_ref_id?: string; p_location_id?: string }
        Returns: string
      }
      record_transfer: {
        Args: { p_sku_id: string; p_qty: number; p_from_location: string; p_to_location: string; p_reason?: string }
        Returns: undefined
      }
      create_production_order: {
        Args: { p_style_id: string; p_vendor_id: string; p_deadline?: string | null; p_notes: string; p_lines: Json }
        Returns: string
      }
      transition_production_stage: {
        Args: { p_po_id: string; p_next_stage: string }
        Returns: undefined
      }
      create_order: {
        Args: { p_channel_id: string; p_order_date?: string | null; p_customer: string; p_notes: string; p_lines: Json }
        Returns: string
      }
      create_return: {
        Args: { p_order_id: string; p_return_date?: string | null; p_reason: string; p_notes: string; p_lines: Json }
        Returns: string
      }
      create_purchase_order: {
        Args: { p_vendor_id: string; p_location_id?: string | null; p_order_date?: string | null; p_notes: string; p_lines: Json }
        Returns: string
      }
      receive_purchase: {
        Args: { p_po_id: string; p_receipts: Json }
        Returns: undefined
      }
      issue_material_to_po: {
        Args: { p_prod_po_id: string; p_issues: Json; p_location_id?: string | null }
        Returns: undefined
      }
      approve_document: {
        Args: { p_kind: string; p_id: string }
        Returns: undefined
      }
      post_journal: {
        Args: { p_date: string | null; p_memo: string | null; p_source_type: string | null; p_source_id: string | null; p_lines: Json }
        Returns: string
      }
      post_opening_balance: {
        Args: Record<string, never>
        Returns: string
      }
      generate_payroll: {
        Args: { p_period: string }
        Returns: string
      }
      post_payroll: {
        Args: { p_run_id: string }
        Returns: string
      }
      create_forecast: {
        Args: { p_kind: string; p_period: string; p_notes: string; p_lines: Json }
        Returns: string
      }
      create_projection: {
        Args: { p_period: string; p_lines: Json }
        Returns: string
      }
      lock_projection: {
        Args: { p_id: string }
        Returns: undefined
      }
      create_pcb: {
        Args: { p_projection_id: string; p_quarter: string; p_lines: Json }
        Returns: string
      }
      create_ppo: {
        Args: { p_pcb_id: string; p_style_id: string; p_scheme: string; p_qty: number; p_notes: string }
        Returns: string
      }
      issue_ppo_pos: {
        Args: { p_ppo_id: string; p_children: Json }
        Returns: undefined
      }
      set_planning_params: {
        Args: { p_cover_months: number; p_selling_days: number; p_net_rate: number; p_lead_time_months: number }
        Returns: undefined
      }
      set_demand_plan: {
        Args: { p_lines: Json }
        Returns: number
      }
      seed_demand_plan: {
        Args: { p_from: string; p_months?: number; p_lookback_days?: number }
        Returns: number
      }
      project_stock: {
        Args: { p_from: string; p_months?: number }
        Returns: {
          sku_id: string; sku_code: string; month: string; order_month: string
          beginning_qty: number; incoming_qty: number; committed_qty: number; suggested_qty: number
          sales_qty: number; ending_qty: number
          incoming_cogs: number; incoming_gross: number
          beginning_cogs: number; beginning_gross: number
          sales_cogs: number; sales_gross: number; sales_net: number
          ending_cogs: number; ending_gross: number
          cover_ratio: number | null
        }[]
      }
      projection_summary: {
        Args: { p_from: string; p_months?: number }
        Returns: {
          month: string
          incoming_cogs: number; incoming_gross: number; beginning_gross: number
          sales_gross: number; sales_net: number; sales_cogs: number
          ending_gross: number; ending_cogs: number
          stock_ratio: number | null; ito: number | null
          gpm: number | null; margin: number | null; roi: number | null
        }[]
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
