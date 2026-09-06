import { Icon } from "@spectron/frontend/components/ui/icon";
import {
  Message,
  MessageBubble,
  DayDivider,
  VoiceMessage,
  FileMessage,
  VideoPreview,
  ImageGallery,
} from "@spectron/frontend/components/feature/chat";

export function DemoConversation({
  onImage,
  onVideo,
  onSource,
}: {
  onImage: (image: string) => void;
  onVideo: () => void;
  onSource: () => void;
}) {
  return (
    <>
      <DayDivider>Today, September 6</DayDivider>
      <Message name="Alex Morgan" time="10:42" source="slack">
        <MessageBubble>
          <p>
            Let’s bring our self-hosted GitLab into Spectron. Merge requests,
            pipelines, and discussions — all here, in the same conversation.
          </p>
          <p>No more “did you see my comment on GitLab?”</p>
        </MessageBubble>
      </Message>
      <Message name="You" time="10:44" own>
        <MessageBubble>
          <p>Yes. One place to keep the context.</p>
          <p>What should we support in the first version?</p>
        </MessageBubble>
        <span className="delivery">
          <Icon name="checks" size={14} /> Seen by Alex
        </span>
      </Message>
      <Message name="Alex Morgan" time="10:46" source="telegram">
        <VoiceMessage src="/demo/voice-note.mp3" />
      </Message>
      <div className="activity">
        <Icon name="gitlab" size={14} />
        <span>
          Alex linked merge request{" "}
          <button
            className="activity-link"
            onClick={onSource}
            aria-label="About sample merge request 48"
          >
            #48
          </button>
          <span className="activity-title"> · Add GitLab provider</span>
        </span>
        <time>10:48</time>
      </div>
      <Message name="Alex Morgan" time="10:49" source="slack">
        <MessageBubble>
          <p>A quick walkthrough of the connection flow.</p>
        </MessageBubble>
        <VideoPreview
          poster="/demo/connection.svg"
          title="GitLab connection flow"
          duration="0:08"
          label="Play GitLab connection walkthrough"
          onPlay={onVideo}
        />
      </Message>
      <Message
        name="Jamie Lee"
        time="10:52"
        source="slack"
        initials="JL"
        color="lavender"
      >
        <MessageBubble>
          <p>And the screens. Kept the setup to two steps.</p>
        </MessageBubble>
        <ImageGallery
          images={[
            {
              url: "/demo/connection.svg",
              alt: "GitLab connection settings design",
              label: "Expand connection screen",
            },
            {
              url: "/demo/events.svg",
              alt: "Webhook event preferences design",
              label: "Expand webhook events screen",
            },
          ]}
          onImage={onImage}
        />
        <FileMessage
          name="gitlab-integration.md"
          url="/demo/gitlab-integration.md"
          size="Markdown · 436 B"
        />
      </Message>
      <Message name="Alex Morgan" time="10:54" source="slack">
        <MessageBubble>
          <p>
            We need to clarify the webhook events before I wire this up.{" "}
            <span className="mention">@Nikita</span> merge requests and
            pipelines first?
          </p>
        </MessageBubble>
      </Message>
    </>
  );
}
