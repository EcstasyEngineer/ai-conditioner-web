/**
 * The theme picker — DESIGN.md §6.1, §6.2, §6.8.
 *
 * ONE FLAT ALPHABETICAL TAG LIST, no ordering and no categories. Excluding heavy
 * register (`intense`) is the same gesture as excluding any other tag, because
 * the intensity ladder that used to sit here is deleted along with the axis it
 * displayed.
 *
 * WHAT IS DELIBERATELY NOT INHERITED (§6.8). Every one of these is a Discord
 * platform artifact that this medium does not have, and each is called out
 * because the temptation is to copy the shape without the constraint:
 *
 *   - no 25-option select cap. Every tag in the vocabulary is rendered, always.
 *     "hypnoapp must not inherit 25 as a number", and it does not appear here.
 *   - no alphabetical TRUNCATION. The list is sorted alphabetically because a
 *     flat list of 23 needs an order a user can scan; nothing is ever cut from
 *     the end of it.
 *   - no 100-char labels, no 45-char modal labels, no 1024/4096 slices. A
 *     description is rendered whole.
 *   - no 5-minute panel expiry and no single-invoker ownership check. A form in
 *     a browser tab has no invoker and does not expire.
 *
 * The soft advisory ("sessions read best with 3-5 themes") is retained from §6.8
 * WITHOUT a gate: it is a sentence, not a limit, and enrolling twelve themes is
 * allowed.
 */

import type { UserConfig } from '../../engine/types/config.ts';
import type { ThemeList } from '../persist/config.ts';
import {
  ALL_TAGS,
  CORPUS_FLOOR,
  ENROLLABLE_TAGS,
  isExclusionOnly,
} from '../../engine/corpus/vocabulary.ts';

/** The advisory band from §6.8. A sentence, never a gate. */
export const ADVISORY_MIN_THEMES = 3;
export const ADVISORY_MAX_THEMES = 5;

/**
 * Every enrollable tag, alphabetically.
 *
 * Computed from the vocabulary rather than written out, so a tag added to
 * `ENROLLABLE_TAGS` appears in the picker without a second edit — the drift that
 * would otherwise show up as a tag a user can be filtered by but cannot see.
 */
export const ENROLLABLE_ALPHABETICAL: readonly string[] = [...ENROLLABLE_TAGS].sort();

/** Every tag that may be excluded — enrollable plus exclusion-only. */
export const EXCLUDABLE_ALPHABETICAL: readonly string[] = [...ALL_TAGS].sort();

/** What the picker needs to know about one tag, per §6.2's live counts. */
export interface TagRow {
  tag: string;
  /** Records carrying this tag that survive the CURRENT filters. */
  available: number;
  /** Records carrying this tag in the unfiltered corpus. */
  total: number;
  /** Records available in the SECOND person — what the center lane draws from. */
  second: number;
  /** True when `available` fell below the floor a lane needs. */
  thin: boolean;
  /** Prose from the pool, when the corpus has it. Rendered whole, never sliced. */
  description?: string;
}

export interface ThemePickerProps {
  config: UserConfig;
  /** Per-tag rows, keyed by tag. Missing rows render as zero, not as absent. */
  rows: Readonly<Record<string, TagRow>>;
  /** Toggle a tag in one of the two lists. Refusals come back from the caller. */
  onToggle(list: ThemeList, tag: string, next: boolean): void;
  /** The refusal to show, when the last toggle lost under §6.3. */
  rejection?: { field: string; message: string; fix: string } | null;
}

function emptyRow(tag: string): TagRow {
  return { tag, available: 0, total: 0, second: 0, thin: true };
}

/**
 * One tag, in one of the two lists.
 *
 * A checkbox rather than a multi-select, precisely because a `<select multiple>`
 * is where an option cap would come from. There is no cap to inherit when every
 * tag is its own control.
 */
function TagCheckbox({
  tag,
  row,
  list,
  checked,
  onToggle,
}: {
  tag: string;
  row: TagRow;
  list: ThemeList;
  checked: boolean;
  onToggle: ThemePickerProps['onToggle'];
}) {
  const id = `${list}-${tag}`;
  return (
    <li className={`tag-row${row.thin ? ' tag-row--thin' : ''}`} data-tag={tag} data-list={list}>
      <label htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onToggle(list, tag, event.currentTarget.checked)}
        />
        <span className="tag-name">{tag.replace(/_/g, ' ')}</span>
        {list === 'themes' ? (
          <span className="tag-counts" data-testid={`counts-${tag}`}>
            <span className="tag-available">{row.available}</span>
            <span className="tag-total"> of {row.total}</span>
            {/* The judges' first addition: 2nd-person availability sits next to
                the raw count, because the center lane draws exclusively from
                second-person variants and a tag rich in mantras but poor in
                them starves the anchor at runtime. */}
            <span className="tag-second"> · {row.second} in 2nd</span>
          </span>
        ) : null}
      </label>
      {row.description ? <p className="tag-description">{row.description}</p> : null}
      {list === 'themes' && row.thin ? (
        <p className="tag-warning" data-testid={`thin-${tag}`}>
          {row.available} left after your exclusions — below the {CORPUS_FLOOR} a lane needs.
        </p>
      ) : null}
    </li>
  );
}

export function ThemePicker({ config, rows, onToggle, rejection }: ThemePickerProps) {
  const enrolled = new Set(config.themes);
  const excluded = new Set(config.excludedThemes);

  return (
    <div className="theme-picker">
      <section className="picker-section" aria-labelledby="themes-heading">
        <h2 id="themes-heading">Themes</h2>
        <p className="picker-advisory">
          Sessions read best with {ADVISORY_MIN_THEMES}–{ADVISORY_MAX_THEMES} themes. You have{' '}
          {config.themes.length}.
        </p>
        <ul className="tag-list" data-testid="enrollable-tags">
          {ENROLLABLE_ALPHABETICAL.map((tag) => (
            <TagCheckbox
              key={tag}
              tag={tag}
              row={rows[tag] ?? emptyRow(tag)}
              list="themes"
              checked={enrolled.has(tag)}
              onToggle={onToggle}
            />
          ))}
        </ul>
      </section>

      <section className="picker-section" aria-labelledby="excluded-heading">
        <h2 id="excluded-heading">Never show me</h2>
        <p className="picker-advisory">
          Checked against every tag a line carries, not just the theme it was collected under.
        </p>
        <ul className="tag-list" data-testid="excludable-tags">
          {EXCLUDABLE_ALPHABETICAL.map((tag) => (
            <TagCheckbox
              key={tag}
              tag={tag}
              row={rows[tag] ?? emptyRow(tag)}
              list="excludedThemes"
              checked={excluded.has(tag)}
              onToggle={onToggle}
            />
          ))}
        </ul>
        <p className="picker-note">
          {EXCLUDABLE_ALPHABETICAL.filter(isExclusionOnly)
            .map((t) => t.replace(/_/g, ' '))
            .join(' and ')}{' '}
          can be excluded but not chosen.
        </p>
      </section>

      {rejection ? (
        <p className="picker-rejection" role="alert" data-testid="theme-rejection">
          {rejection.message}. {rejection.fix}.
        </p>
      ) : null}
    </div>
  );
}
