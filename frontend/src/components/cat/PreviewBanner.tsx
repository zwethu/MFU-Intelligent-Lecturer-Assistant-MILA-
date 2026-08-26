import { Eye } from '@phosphor-icons/react';
import './PreviewBanner.css';

/**
 * The strip a lecturer sees while walking through their own game.
 *
 * It has one job beyond decoration: state plainly that nothing is being recorded.
 * A preview run looks exactly like a real one — same rounds, same timer, same result
 * screen — and without this a lecturer would reasonably assume they had just put a
 * fake score into their own class data.
 */
export default function PreviewBanner({
  title,
  backTo,
}: {
  title?: string;
  backTo?: string;
}) {
  return (
    <div className="preview-banner" role="status">
      <Eye size={18} weight="fill" className="preview-banner__icon" />
      <span className="preview-banner__text">
        <strong>Preview — results are not saved.</strong>{' '}
        {title ? <>You created “{title}”. </> : null}
        Nothing you do here is recorded.
      </span>
      {backTo && (
        /* A full navigation, not a router Link: this tab was opened from the details
           page and deliberately sits outside the teacher shell. */
        <a className="preview-banner__back" href={backTo}>
          Back to game details
        </a>
      )}
    </div>
  );
}
