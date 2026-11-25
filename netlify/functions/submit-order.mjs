import { timingSafeEqual } from "node:crypto";

export default async (request) => {
  const reply = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json"
      }
    });

  if (request.method !== "POST") {
    return reply({
      success: false,
      error: "Method not allowed"
    }, 405);
  }

  const scriptUrl = process.env.GOOGLE_SCRIPT_URL;
  const orderSecret = process.env.ORDER_SECRET;
  const agentSecret = process.env.AGENT_SECRET;

  if (!scriptUrl || !orderSecret || !agentSecret) {
    return reply({
      success: false,
      error: "Server configuration missing"
    }, 503);
  }

  const received = Buffer.from(
    request.headers.get("x-agent-secret") || ""
  );
  const expected = Buffer.from(agentSecret);

  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    return reply({
      success: false,
      error: "Unauthorized"
    }, 401);
  }

  try {
    const data = await request.json();

    if (!/^03[0-9]{9}$/.test(String(data.phone || ""))) {
      return reply({
        success: false,
        error: "Invalid phone number"
      }, 400);
    }

    if (
      !data.customerName ||
      !data.orderDetails ||
      !data.orderId ||
      !["Delivery", "Pickup"].includes(data.orderType)
    ) {
      return reply({
        success: false,
        error: "Incomplete order"
      }, 400);
    }

    if (data.orderType === "Delivery" && !data.address) {
      return reply({
        success: false,
        error: "Delivery address required"
      }, 400);
    }

    const subtotal = Number(data.subtotal);
    const deliveryCharges = Number(data.deliveryCharges);

    if (
      !Number.isFinite(subtotal) ||
      subtotal <= 0 ||
      !Number.isFinite(deliveryCharges) ||
      deliveryCharges < 0 ||
      (data.orderType === "Pickup" && deliveryCharges !== 0)
    ) {
      return reply({
        success: false,
        error: "Invalid bill"
      }, 400);
    }

    const response = await fetch(scriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...data,
        subtotal,
        deliveryCharges,
        secret: orderSecret
      }),
      redirect: "follow"
    });

    if (!response.ok) {
      throw new Error("Order service unavailable");
    }

    const result = await response.json();

    return reply(
      result,
      result.success === true ? 200 : 422
    );

  } catch (error) {
    return reply({
      success: false,
      error: "Order submission failed"
    }, 502);
  }
};
