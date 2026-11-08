import { createDeviceSecret, formatKioskToken } from "../../lib/kioskToken";
import { kioskRepository, type KioskDeviceDto } from "./kiosk.repository";
import type { CreateKioskDeviceInput } from "./kiosk.schemas";
import type { Actor } from "../../types/actor";

/**
 * Issuing a device.
 *
 * The order in `create` is the whole security property: mint the secret, hash
 * it, insert the hash, and only then assemble the token from the id the row
 * generated. If the insert fails there is no token, and the secret that was
 * never stored is simply discarded.
 *
 * `token` is returned exactly once. There is no endpoint that shows it again,
 * because the database cannot: it holds a digest, and that is the point.
 */
export const kioskService = {
  listDevices(): Promise<KioskDeviceDto[]> {
    return kioskRepository.list();
  },

  async createDevice(
    input: CreateKioskDeviceInput,
    actor: Actor
  ): Promise<{ device: KioskDeviceDto; token: string }> {
    const { secret, hash } = createDeviceSecret();
    const device = await kioskRepository.create(input.label, hash, actor.id);

    return { device, token: formatKioskToken(device.id, secret) };
  },

  revokeDevice(id: string, actor: Actor): Promise<KioskDeviceDto> {
    return kioskRepository.revoke(id, actor.id);
  },
};
