/** Opaque-origin presentation for declarative installable RP UI Slots. */
import type { CSSProperties, ReactNode } from 'react'
import type { RpWebCatalog, RpWebUiSlotSummary } from '../types.ts'
import type { RpStudioLocaleKey } from './locales.ts'

interface UiSlotFramesProps {
  readonly catalog: Pick<RpWebCatalog, 'uiSlots'>
  readonly placement: RpWebUiSlotSummary['placement']
  readonly t: (key: RpStudioLocaleKey) => string
  readonly variant?: 'studio' | 'sidebar' | 'message'
}

/**
 * Render live package frames without script, same-origin, navigation, or Host bridge grants.
 * @param props - Detached catalog, fixed placement, and locale lookup.
 * @returns Opaque-origin frame section, or null when the placement has no live contributions.
 */
export function UiSlotFrames({ catalog, placement, t, variant = 'studio' }: UiSlotFramesProps): ReactNode {
  const slots = catalog.uiSlots.filter(slot => slot.placement === placement)
  if (slots.length === 0) return null
  const embedded = variant !== 'studio'
  return <section style={embedded ? styles.embeddedStack : styles.stack} data-rp-ui-placement={placement}>
    {variant === 'studio' ? <h3 style={styles.h3}>{t('pluginUi')}</h3> : null}
    {slots.map(slot => <article
      key={`${slot.packageId}:${slot.id}`}
      style={embedded ? styles.embeddedFrameCard : styles.pluginFrameCard}
    >
      <div style={styles.cardTitle}>
        <div>
          <strong>{slot.title}</strong>
          <p style={styles.muted}>{slot.packageId}@{slot.packageVersion} · {slot.id}</p>
        </div>
        <span style={styles.kind}>{slot.trust} · {t('opaqueSandbox')}</span>
      </div>
      <iframe
        title={`${slot.title} (${slot.packageId})`}
        src={slot.entryUrl}
        sandbox=""
        referrerPolicy="no-referrer"
        loading="lazy"
        style={{ ...styles.pluginFrame, height: slot.height }}
      />
    </article>)}
  </section>
}

const styles: Record<string, CSSProperties> = {
  stack: { display: 'grid', gap: 12 },
  embeddedStack: { display: 'grid', gap: 8, minWidth: 0 },
  h3: { margin: '8px 0 0', fontSize: 15 },
  cardTitle: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  muted: { margin: '5px 0 0', opacity: 0.68, fontSize: 12 },
  kind: { fontSize: 11, padding: '4px 7px', borderRadius: 999, background: 'rgba(95,120,190,.16)' },
  pluginFrameCard: {
    border: '1px solid rgba(130,145,180,.2)',
    borderRadius: 12,
    padding: 14,
    background: 'rgba(20,24,36,.42)',
    overflow: 'hidden',
  },
  embeddedFrameCard: {
    border: '1px solid rgba(130,145,180,.2)',
    borderRadius: 10,
    padding: 9,
    background: 'rgba(20,24,36,.32)',
    overflow: 'hidden',
  },
  pluginFrame: {
    display: 'block',
    width: '100%',
    minHeight: 120,
    maxHeight: 1600,
    border: '1px solid rgba(130,145,180,.18)',
    borderRadius: 9,
    marginTop: 12,
    background: 'transparent',
  },
}
