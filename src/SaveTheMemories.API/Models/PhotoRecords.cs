namespace RecNetImageApi.Models;

public sealed class PhotoRecord
{
    public long Id { get; set; }
    public int Type { get; set; }
    public int Accessibility { get; set; }
    public bool AccessibilityLocked { get; set; }
    public string? ImageName { get; set; }
    public string? Description { get; set; }
    public long PlayerId { get; set; }
    public List<long>? TaggedPlayerIds { get; set; }
    public long RoomId { get; set; }
    public long? PlayerEventId { get; set; }
    public DateTime CreatedAt { get; set; }
    public int CheerCount { get; set; }
    public int CommentCount { get; set; }
}
