import { createClient } from "npm:@supabase/supabase-js@2";
import { getAuthenticatedUserId } from "../_shared/authorization.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Actions that require the player to be online (playback control)
const REQUIRES_ONLINE = new Set(["add", "next"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    let body: unknown;
    try {
      body = await req.json();
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof TypeError) {
        return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw error;
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return new Response(JSON.stringify({ error: "JSON body must be an object" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const requestBody = body as Record<string, unknown>;
    const player_id = requestBody.player_id;
    const action = requestBody.action;
    const media_item_id = requestBody.media_item_id;
    const queue_id = requestBody.queue_id;
    const queue_ids = requestBody.queue_ids;
    const requestedType = requestBody.type === undefined ? "normal" : requestBody.type;
    const type = typeof requestedType === "string" ? requestedType : "";
    const requested_by = requestBody.requested_by === undefined ? "admin" : requestBody.requested_by;

    if (typeof player_id !== "string" || !player_id) {
      return new Response(JSON.stringify({ error: "player_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeof action !== "string" || !action) {
      return new Response(JSON.stringify({ error: "action is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify player exists
    const { data: player, error: playerError } = await supabase
      .from("players")
      .select("status, owner_id")
      .eq("id", player_id)
      .maybeSingle();

    if (playerError) throw playerError;
    if (!player) {
      return new Response(JSON.stringify({ error: "Player not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (player.owner_id !== userId) {
      return new Response(JSON.stringify({ error: "Not authorized for this player" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (["add", "reorder", "clear", "shuffle"].includes(action)
      && type !== "normal"
      && type !== "priority") {
      return new Response(JSON.stringify({ error: "type must be normal or priority" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Only block playback-triggering actions when player is offline.
    // Admin queue management (remove, reorder, clear, skip) works regardless.
    if (REQUIRES_ONLINE.has(action) && player.status !== "online") {
      return new Response(JSON.stringify({ error: "Player is offline" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let result: unknown;

    switch (action) {
      case "add": {
        if (typeof media_item_id !== "string" || !media_item_id) {
          return new Response(
            JSON.stringify({ error: "media_item_id is required for add action" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const { data: queueId, error: addError } = await supabase.rpc("queue_add", {
          p_player_id: player_id,
          p_media_item_id: media_item_id,
          p_type: type,
          p_requested_by: typeof requested_by === "string" ? requested_by : "admin",
        });
        if (addError) throw addError;
        result = { queue_id: queueId };
        break;
      }

      case "remove": {
        if (typeof queue_id !== "string" || !queue_id) {
          return new Response(
            JSON.stringify({ error: "queue_id is required for remove action" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const { data: queueItem, error: queueItemError } = await supabase
          .from("queue")
          .select("id")
          .eq("id", queue_id)
          .eq("player_id", player_id)
          .is("played_at", null)
          .maybeSingle();
        if (queueItemError) throw queueItemError;
        if (!queueItem) {
          return new Response(JSON.stringify({ error: "Queue item not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const { error: removeError } = await supabase.rpc("queue_remove", {
          p_queue_id: queue_id,
        });
        if (removeError) throw removeError;
        result = { success: true };
        break;
      }

      case "reorder": {
        if (!Array.isArray(queue_ids) || queue_ids.some((id) => typeof id !== "string")) {
          return new Response(
            JSON.stringify({ error: "queue_ids array is required for reorder action" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const { error: reorderError } = await supabase.rpc("queue_reorder", {
          p_player_id: player_id,
          p_queue_ids: queue_ids,
          p_type: type,
        });
        if (reorderError) throw reorderError;
        result = { success: true };
        break;
      }

      case "next": {
        const { data: nextItem, error: nextError } = await supabase.rpc("queue_next", {
          p_player_id: player_id,
        });
        if (nextError) throw nextError;
        result = { next_item: Array.isArray(nextItem) ? nextItem[0] : nextItem ?? null };
        break;
      }

      case "skip": {
        const { error: skipError } = await supabase.rpc("queue_skip", {
          p_player_id: player_id,
        });
        if (skipError) throw skipError;
        result = { success: true };
        break;
      }

      case "clear": {
        const { error: clearError } = await supabase.rpc("queue_clear", {
          p_player_id: player_id,
          p_type: type,
        });
        if (clearError) throw clearError;
        result = { success: true };
        break;
      }

      case "shuffle": {
        const { error: shuffleError } = await supabase.rpc("queue_shuffle", {
          p_player_id: player_id,
          p_type: type,
        });
        if (shuffleError) throw shuffleError;
        result = { success: true };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Queue manager error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error)?.message ?? String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
