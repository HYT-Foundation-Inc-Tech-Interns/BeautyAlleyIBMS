/**
 * Database types.
 *
 * HAND-WRITTEN, not generated. `supabase gen types typescript` needs the
 * Supabase CLI, which needs Docker, which is not available in this
 * environment (see DESIGN.md §0). These are transcribed from the migrations in
 * supabase/migrations and are the source of truth for every query in
 * src/modules.
 *
 * If the schema changes, this file must change with it. That is a real
 * maintenance cost, and the alternative - leaving the client untyped - is
 * worse: without these, every `.select()` returns `any` and a column renamed
 * in SQL becomes a runtime 500 instead of a compile error.
 *
 * Money is integer minor units (centavos) everywhere. Timestamps are
 * timestamptz, serialised as ISO strings.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type UserRole = "GUEST" | "CLIENT" | "STAFF" | "ADMIN";
export type ServiceCategory = "SPA" | "SALON" | "WELLNESS";
export type BookingStatus =
  | "PENDING"
  | "CONFIRMED"
  | "CHECKED_IN"
  | "IN_SERVICE"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";
export type PromoType = "PERCENT" | "FIXED";
/** Migration 17. `required_room_type` on a service is NULL when no room is needed. */
export type RoomType = "MASSAGE" | "FACIAL" | "NAIL" | "WAXING" | "SAUNA" | "VIP" | "OTHER";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          role: UserRole;
          full_name: string | null;
          phone: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          role?: UserRole;
          full_name?: string | null;
          phone?: string | null;
          is_active?: boolean;
        };
        Update: {
          role?: UserRole;
          full_name?: string | null;
          phone?: string | null;
          is_active?: boolean;
        };
        Relationships: [];
      };

      clients: {
        Row: {
          id: string;
          profile_id: string | null;
          full_name: string;
          phone: string | null;
          email: string | null;
          notes: string | null;
          is_active: boolean;
          /** Migration 17. NULL until staff promote the client. */
          member_since: string | null;
          /** Migration 17. Member rate on every booking, stacked with promos. */
          discount_percent: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          profile_id?: string | null;
          full_name: string;
          phone?: string | null;
          email?: string | null;
          notes?: string | null;
          is_active?: boolean;
          member_since?: string | null;
          discount_percent?: number;
        };
        Update: {
          profile_id?: string | null;
          full_name?: string;
          phone?: string | null;
          email?: string | null;
          notes?: string | null;
          is_active?: boolean;
          member_since?: string | null;
          discount_percent?: number;
        };
        Relationships: [];
      };

      employees: {
        Row: {
          id: string;
          profile_id: string | null;
          full_name: string;
          title: string | null;
          bio: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          profile_id?: string | null;
          full_name: string;
          title?: string | null;
          bio?: string | null;
          is_active?: boolean;
        };
        Update: {
          profile_id?: string | null;
          full_name?: string;
          title?: string | null;
          bio?: string | null;
          is_active?: boolean;
        };
        Relationships: [];
      };

      services: {
        Row: {
          id: string;
          name: string;
          category: ServiceCategory;
          description: string | null;
          price_cents: number;
          duration_minutes: number;
          /** Migration 17. NULL = the service needs no room. */
          required_room_type: RoomType | null;
          /** Migration 17. Second catalogue level. */
          subcategory_id: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          category: ServiceCategory;
          description?: string | null;
          price_cents: number;
          duration_minutes: number;
          required_room_type?: RoomType | null;
          subcategory_id?: string | null;
          is_active?: boolean;
        };
        Update: {
          name?: string;
          category?: ServiceCategory;
          description?: string | null;
          price_cents?: number;
          duration_minutes?: number;
          required_room_type?: RoomType | null;
          subcategory_id?: string | null;
          is_active?: boolean;
        };
        Relationships: [];
      };

      employee_services: {
        Row: { employee_id: string; service_id: string; created_at: string };
        Insert: { employee_id: string; service_id: string };
        Update: { employee_id?: string; service_id?: string };
        Relationships: [];
      };

      working_hours: {
        Row: {
          id: string;
          employee_id: string;
          weekday: number;
          start_time: string;
          end_time: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          weekday: number;
          start_time: string;
          end_time: string;
        };
        Update: {
          employee_id?: string;
          weekday?: number;
          start_time?: string;
          end_time?: string;
        };
        Relationships: [];
      };

      time_off: {
        Row: {
          id: string;
          employee_id: string;
          starts_at: string;
          ends_at: string;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          employee_id: string;
          starts_at: string;
          ends_at: string;
          reason?: string | null;
        };
        Update: {
          employee_id?: string;
          starts_at?: string;
          ends_at?: string;
          reason?: string | null;
        };
        Relationships: [];
      };

      booking_counters: {
        Row: { day: string; last_value: number };
        Insert: { day: string; last_value?: number };
        Update: { last_value?: number };
        Relationships: [];
      };

      bookings: {
        Row: {
          id: string;
          reference: string;
          client_id: string | null;
          guest_name: string | null;
          guest_phone: string | null;
          employee_id: string;
          start_time: string;
          end_time: string;
          status: BookingStatus;
          subtotal_cents: number;
          discount_cents: number;
          total_cents: number;
          promo_code_id: string | null;
          notes: string | null;
          /** Migration 17. Set by the auto-assigner, overridable at the desk. */
          room_id: string | null;
          cancelled_at: string | null;
          cancellation_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          reference: string;
          client_id?: string | null;
          guest_name?: string | null;
          guest_phone?: string | null;
          employee_id: string;
          start_time: string;
          end_time: string;
          status?: BookingStatus;
          subtotal_cents: number;
          discount_cents?: number;
          total_cents: number;
          promo_code_id?: string | null;
          notes?: string | null;
          room_id?: string | null;
          cancelled_at?: string | null;
          cancellation_reason?: string | null;
        };
        Update: {
          start_time?: string;
          end_time?: string;
          status?: BookingStatus;
          cancelled_at?: string | null;
          cancellation_reason?: string | null;
          notes?: string | null;
          room_id?: string | null;
        };
        Relationships: [];
      };

      booking_items: {
        Row: {
          id: string;
          booking_id: string;
          service_id: string | null;
          employee_id: string | null;
          name_snapshot: string;
          price_cents_snapshot: number;
          duration_minutes_snapshot: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          service_id?: string | null;
          employee_id?: string | null;
          name_snapshot: string;
          price_cents_snapshot: number;
          duration_minutes_snapshot: number;
        };
        Update: {
          service_id?: string | null;
          employee_id?: string | null;
          name_snapshot?: string;
          price_cents_snapshot?: number;
          duration_minutes_snapshot?: number;
        };
        Relationships: [];
      };

      promo_codes: {
        Row: {
          id: string;
          code: string;
          type: PromoType;
          value: number;
          starts_at: string | null;
          ends_at: string | null;
          max_redemptions: number | null;
          per_client_limit: number | null;
          min_spend_cents: number;
          applicable_service_ids: string[] | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          type: PromoType;
          value: number;
          starts_at?: string | null;
          ends_at?: string | null;
          max_redemptions?: number | null;
          per_client_limit?: number | null;
          min_spend_cents?: number;
          applicable_service_ids?: string[] | null;
          is_active?: boolean;
        };
        Update: {
          type?: PromoType;
          value?: number;
          starts_at?: string | null;
          ends_at?: string | null;
          max_redemptions?: number | null;
          per_client_limit?: number | null;
          min_spend_cents?: number;
          applicable_service_ids?: string[] | null;
          is_active?: boolean;
        };
        Relationships: [];
      };

      promo_redemptions: {
        Row: {
          id: string;
          promo_code_id: string;
          booking_id: string;
          client_id: string | null;
          guest_phone: string | null;
          amount_cents: number;
          created_at: string;
          released_at: string | null;
        };
        Insert: {
          id?: string;
          promo_code_id: string;
          booking_id: string;
          client_id?: string | null;
          guest_phone?: string | null;
          amount_cents: number;
          released_at?: string | null;
        };
        Update: { released_at?: string | null };
        Relationships: [];
      };

      // --- migration 17 ------------------------------------------------------

      rooms: {
        Row: {
          id: string;
          name: string;
          room_type: RoomType;
          capacity: number;
          notes: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          room_type: RoomType;
          capacity?: number;
          notes?: string | null;
          is_active?: boolean;
        };
        Update: {
          name?: string;
          room_type?: RoomType;
          capacity?: number;
          notes?: string | null;
          is_active?: boolean;
        };
        Relationships: [];
      };

      service_subcategories: {
        Row: {
          id: string;
          category: ServiceCategory;
          name: string;
          slug: string;
          sort_order: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          category: ServiceCategory;
          name: string;
          slug: string;
          sort_order?: number;
          is_active?: boolean;
        };
        Update: {
          category?: ServiceCategory;
          name?: string;
          slug?: string;
          sort_order?: number;
          is_active?: boolean;
        };
        Relationships: [];
      };

      booking_notes: {
        Row: {
          id: string;
          booking_id: string;
          author_id: string | null;
          body: string;
          visible_to_client: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          author_id?: string | null;
          body: string;
          visible_to_client?: boolean;
        };
        Update: {
          author_id?: string | null;
          body?: string;
          visible_to_client?: boolean;
        };
        Relationships: [];
      };

      qr_tokens: {
        Row: {
          id: string;
          booking_id: string;
          jti: string;
          expires_at: string;
          used_at: string | null;
          revoked_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          jti?: string;
          expires_at: string;
          used_at?: string | null;
          revoked_at?: string | null;
        };
        Update: { used_at?: string | null; revoked_at?: string | null };
        Relationships: [];
      };

      checkins: {
        Row: {
          id: string;
          booking_id: string;
          staff_id: string | null;
          checked_in_at: string;
        };
        Insert: { id?: string; booking_id: string; staff_id?: string | null };
        Update: { staff_id?: string | null };
        Relationships: [];
      };

      audit_logs: {
        Row: {
          id: string;
          actor_id: string | null;
          actor_role: UserRole | null;
          action: string;
          entity: string;
          entity_id: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id?: string | null;
          actor_role?: UserRole | null;
          action: string;
          entity: string;
          entity_id?: string | null;
          metadata?: Json;
        };
        Update: { metadata?: Json };
        Relationships: [];
      };

      login_attempts: {
        Row: {
          id: string;
          email: string | null;
          succeeded: boolean;
          ip: string | null;
          created_at: string;
        };
        Insert: { id?: string; email?: string | null; succeeded: boolean; ip?: string | null };
        Update: { succeeded?: boolean };
        Relationships: [];
      };
    };

    Views: {
      v_booking_detail: {
        Row: {
          id: string;
          reference: string;
          status: BookingStatus;
          start_time: string;
          end_time: string;
          employee_id: string;
          employee_name: string | null;
          client_id: string | null;
          client_name: string | null;
          guest_name: string | null;
          guest_phone: string | null;
          subtotal_cents: number;
          discount_cents: number;
          total_cents: number;
          promo_code_id: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
          /** Migration 19. */
          room_id: string | null;
          room_name: string | null;
          room_type: RoomType | null;
          member_discount_percent: number | null;
        };
        Relationships: [];
      };
      v_daily_revenue: {
        Row: {
          day: string;
          bookings: number;
          completed: number;
          cancelled: number;
          no_show: number;
          revenue_cents: number;
          discount_cents: number;
        };
        Relationships: [];
      };
      v_client_history: {
        Row: {
          id: string;
          full_name: string;
          phone: string | null;
          email: string | null;
          is_active: boolean;
          total_bookings: number;
          completed_bookings: number;
          no_show_bookings: number;
          lifetime_value_cents: number;
          first_visit_at: string | null;
          last_visit_at: string | null;
        };
        Relationships: [];
      };
      v_employee_utilisation: {
        Row: {
          employee_id: string;
          full_name: string;
          day: string;
          bookings: number;
          booked_minutes: number;
        };
        Relationships: [];
      };
      /**
       * Migration 17. The visit count is derived here, never stored, so
       * cancelling a booking corrects it. `count(*) filter` in the view is a
       * bigint, which PostgREST renders as a number - typed as `number` to
       * match the other reporting views.
       */
      v_client_loyalty: {
        Row: {
          client_id: string;
          full_name: string;
          phone: string | null;
          email: string | null;
          member_since: string | null;
          discount_percent: number;
          completed_visits: number;
          eligible_for_membership: boolean;
        };
        Relationships: [];
      };
    };

    Functions: {
      branch_timezone: { Args: Record<string, never>; Returns: string };
      /** Migration 17. Completed visits needed before staff may promote. */
      membership_visit_threshold: { Args: Record<string, never>; Returns: number };
      next_booking_reference: { Args: { p_day?: string | null }; Returns: string };
      write_audit: {
        Args: {
          p_actor: string | null;
          p_action: string;
          p_entity: string;
          p_entity_id: string | null;
          p_metadata?: Json;
        };
        Returns: undefined;
      };
      validate_promo: {
        Args: {
          p_code: string;
          p_client_id?: string | null;
          p_guest_phone?: string | null;
          p_service_ids?: string[] | null;
          p_subtotal_cents?: number;
        };
        Returns: {
          valid: boolean;
          reason: string;
          discountCents: number;
          promoCodeId: string | null;
          code?: string;
          type?: PromoType;
          value?: number;
          minSpendCents?: number;
        };
      };
      get_available_slots: {
        Args: {
          p_service_id: string;
          p_date: string;
          p_employee_id?: string | null;
          p_interval_minutes?: number;
          p_timezone?: string | null;
        };
        Returns: { employee_id: string; slot_start: string; slot_end: string }[];
      };
      create_booking: {
        Args: {
          p_service_ids: string[];
          p_employee_id?: string | null;
          p_start_time?: string | null;
          p_client_id?: string | null;
          p_guest?: Json | null;
          p_promo_code?: string | null;
          p_actor?: string | null;
          p_notes?: string | null;
          p_enforce_hours?: boolean;
          /** Migration 18. NULL = auto-assign a room when the service needs one. */
          p_room_id?: string | null;
        };
        Returns: {
          bookingId: string;
          reference: string;
          employeeId: string;
          roomId: string | null;
          roomType: RoomType | null;
          startTime: string;
          endTime: string;
          status: BookingStatus;
          subtotalCents: number;
          discountCents: number;
          memberDiscountCents: number;
          promoDiscountCents: number;
          totalCents: number;
          jti: string;
        };
      };
      // --- migration 18: membership and the desk's room override -------------
      promote_client: {
        Args: { p_client_id: string; p_discount_percent?: number; p_actor?: string | null };
        Returns: {
          clientId: string;
          memberSince: string;
          discountPercent: number;
          completedVisits: number;
          threshold: number;
        };
      };
      revoke_membership: {
        Args: { p_client_id: string; p_actor?: string | null };
        Returns: { clientId: string; memberSince: null; discountPercent: number };
      };
      set_booking_room: {
        Args: { p_booking_id: string; p_room_id: string | null; p_actor?: string | null };
        Returns: { bookingId: string; roomId: string | null; roomType: RoomType | null };
      };
      cancel_booking: {
        Args: {
          p_booking_id: string;
          p_actor?: string | null;
          p_reason?: string | null;
          p_force?: boolean;
          p_window_hours?: number;
        };
        Returns: { bookingId: string; status: BookingStatus; cancelledAt: string };
      };
      reschedule_booking: {
        Args: { p_booking_id: string; p_new_start: string; p_actor?: string | null };
        Returns: { bookingId: string; startTime: string; endTime: string; jti: string };
      };
      check_in_booking: {
        Args: {
          p_jti: string;
          p_staff_id?: string | null;
          p_actor?: string | null;
          p_window_minutes?: number;
        };
        Returns: {
          bookingId: string;
          reference: string;
          status: BookingStatus;
          checkedInAt: string;
          checkinId: string;
        };
      };
      get_dashboard_summary: {
        Args: { p_from: string; p_to: string; p_timezone?: string | null };
        Returns: Json;
      };
      get_employee_performance: {
        Args: {
          p_employee_id: string;
          p_from: string;
          p_to: string;
          p_timezone?: string | null;
        };
        Returns: Json;
      };
    };

    Enums: {
      user_role: UserRole;
      service_category: ServiceCategory;
      booking_status: BookingStatus;
      promo_type: PromoType;
    };

    CompositeTypes: Record<string, never>;
  };
}

/** Convenience aliases used across the modules. */
export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type Views<T extends keyof Database["public"]["Views"]> =
  Database["public"]["Views"][T]["Row"];
