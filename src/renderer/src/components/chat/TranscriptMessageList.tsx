import * as React from 'react'
import type { ToolResultContent, UnifiedMessage } from '@renderer/lib/api/types'
import { cn } from '@renderer/lib/utils'
import { MessageItem } from './MessageItem'
import {
  buildRenderableMessageMetaFromAnalysis,
  buildTranscriptStaticAnalysis
} from './transcript-utils'

interface TranscriptMessageListProps {
  messages: UnifiedMessage[]
  streamingMessageId?: string | null
  className?: string
}

type ToolResultsLookup = Map<string, { content: ToolResultContent; isError?: boolean }>

interface TranscriptMessageRowProps {
  message: UnifiedMessage
  isStreaming: boolean
  isLastUserMessage: boolean
  isLastAssistantMessage: boolean
  toolResults?: ToolResultsLookup
}

const TranscriptMessageRow = React.memo(function TranscriptMessageRow({
  message,
  isStreaming,
  isLastUserMessage,
  isLastAssistantMessage,
  toolResults
}: TranscriptMessageRowProps): React.JSX.Element {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-6">
      <MessageItem
        message={message}
        messageId={message.id}
        sessionId={null}
        isStreaming={isStreaming}
        isLastUserMessage={isLastUserMessage}
        isLastAssistantMessage={isLastAssistantMessage}
        disableAnimation
        toolResults={toolResults}
        renderMode="transcript"
      />
    </div>
  )
})

function TranscriptMessageListInner({
  messages,
  streamingMessageId = null,
  className
}: TranscriptMessageListProps): React.JSX.Element {
  const transcriptAnalysis = React.useMemo(
    () => buildTranscriptStaticAnalysis(messages),
    [messages]
  )
  const { messageLookup, toolResultsLookup } = transcriptAnalysis
  const renderableMeta = React.useMemo(
    () => buildRenderableMessageMetaFromAnalysis(transcriptAnalysis, streamingMessageId),
    [streamingMessageId, transcriptAnalysis]
  )

  if (renderableMeta.length === 0) {
    return <div className="text-sm text-muted-foreground/70">No playback available</div>
  }

  return (
    <div className={cn('not-prose h-[min(60vh,40rem)] min-h-[20rem] overflow-y-auto', className)}>
      {renderableMeta.map((meta) => {
        const message = messageLookup.get(meta.messageId)

        if (!message) {
          return null
        }

        return (
          <TranscriptMessageRow
            key={meta.messageId}
            message={message}
            isStreaming={streamingMessageId === message.id}
            isLastUserMessage={meta.isLastUserMessage}
            isLastAssistantMessage={meta.isLastAssistantMessage}
            toolResults={toolResultsLookup.get(message.id)}
          />
        )
      })}
    </div>
  )
}

function areTranscriptMessageListPropsEqual(
  prev: TranscriptMessageListProps,
  next: TranscriptMessageListProps
): boolean {
  return (
    prev.messages === next.messages &&
    prev.streamingMessageId === next.streamingMessageId &&
    prev.className === next.className
  )
}

export const TranscriptMessageList = React.memo(
  TranscriptMessageListInner,
  areTranscriptMessageListPropsEqual
)
