"""SqsMessageQueue against botocore's Stubber: no network, no credentials, no AWS."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import botocore.session
import pytest
from botocore.exceptions import EndpointConnectionError
from botocore.stub import Stubber

from lai_processing.ports.queue import Delivery, MessageQueue, QueueFull
from lai_processing_runtime.sqs import QueueError, SqsMessageQueue

URL = "https://sqs.eu-west-2.amazonaws.com/123456789012/lai-dev-processing-completions"
_SESSION = botocore.session.get_session()


def make_client() -> Any:
    return _SESSION.create_client(
        "sqs",
        region_name="eu-west-2",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",  # noqa: S106 - a stub credential, never used
    )


@pytest.fixture
def sqs() -> Iterator[tuple[SqsMessageQueue, Stubber]]:
    client = make_client()
    stubber = Stubber(client)
    with stubber:
        yield SqsMessageQueue(client, URL, wait_seconds=5), stubber
        stubber.assert_no_pending_responses()


def delivery(receipt: str = "rh-1") -> Delivery:
    return Delivery("m-1", receipt, b"{}", 1)


def test_implements_the_port(sqs: tuple[SqsMessageQueue, Stubber]) -> None:
    queue = sqs[0]
    assert isinstance(queue, MessageQueue)
    assert queue.max_message_bytes == 240 * 1024


def test_send(sqs: tuple[SqsMessageQueue, Stubber]) -> None:
    queue, stub = sqs
    stub.add_response(
        "send_message",
        {"MessageId": "m-1", "MD5OfMessageBody": "0" * 32},
        {"QueueUrl": URL, "MessageBody": '{"a":1}'},
    )
    assert queue.send(b'{"a":1}').message_id == "m-1"
    stub.add_response(
        "send_message",
        {"MessageId": "m-2"},
        {"QueueUrl": URL, "MessageBody": "{}", "DelaySeconds": 30},
    )
    assert queue.send(b"{}", delay_seconds=30).message_id == "m-2"


def test_send_size_and_delay_limits(sqs: tuple[SqsMessageQueue, Stubber]) -> None:
    queue, _ = sqs
    with pytest.raises(ValueError):
        queue.send(b"x" * (240 * 1024 + 1))
    with pytest.raises(ValueError):
        queue.send(b"{}", delay_seconds=901)
    with pytest.raises(ValueError):
        queue.send(b"\xff\xfe")
    small = SqsMessageQueue(make_client(), URL, max_message_bytes=10)
    with pytest.raises(ValueError):
        small.send(b"x" * 11)
    with pytest.raises(ValueError):
        SqsMessageQueue(make_client(), URL, max_message_bytes=300 * 1024)


@pytest.mark.parametrize(
    ("code", "status"),
    [("ThrottlingException", 400), ("ServiceUnavailable", 503), ("InternalError", 500)],
)
def test_transient_send_errors_are_queue_full(
    sqs: tuple[SqsMessageQueue, Stubber], code: str, status: int
) -> None:
    queue, stub = sqs
    stub.add_client_error("send_message", service_error_code=code, http_status_code=status)
    with pytest.raises(QueueFull):
        queue.send(b"{}")


def test_connection_failure_on_send_is_queue_full() -> None:
    class Client:
        def send_message(self, **params: Any) -> dict[str, Any]:
            raise EndpointConnectionError(endpoint_url=URL)

    with pytest.raises(QueueFull):
        SqsMessageQueue(Client(), URL).send(b"{}")


def test_permanent_send_errors_are_queue_errors(sqs: tuple[SqsMessageQueue, Stubber]) -> None:
    queue, stub = sqs
    stub.add_client_error(
        "send_message",
        service_error_code="AccessDenied",
        http_status_code=403,
        service_message="secret text",
    )
    with pytest.raises(QueueError) as caught:
        queue.send(b"{}")
    assert caught.value.code == "AccessDenied" and not caught.value.transient
    assert "secret" not in str(caught.value)


def test_receive_maps_receive_count(sqs: tuple[SqsMessageQueue, Stubber]) -> None:
    queue, stub = sqs
    stub.add_response(
        "receive_message",
        {
            "Messages": [
                {
                    "MessageId": "m-1",
                    "ReceiptHandle": "rh-1",
                    "Body": '{"a":1}',
                    "Attributes": {"ApproximateReceiveCount": "3"},
                },
                {"MessageId": "m-2", "ReceiptHandle": "rh-2", "Body": "{}"},
            ]
        },
        {
            "QueueUrl": URL,
            "MaxNumberOfMessages": 10,
            "WaitTimeSeconds": 5,
            "VisibilityTimeout": 300,
            "AttributeNames": ["ApproximateReceiveCount"],
        },
    )
    got = queue.receive(max_messages=10, visibility_seconds=300)
    assert got == [
        Delivery("m-1", "rh-1", b'{"a":1}', 3),
        Delivery("m-2", "rh-2", b"{}", 1),
    ]


def test_receive_empty_and_limits(sqs: tuple[SqsMessageQueue, Stubber]) -> None:
    queue, stub = sqs
    stub.add_response("receive_message", {})
    assert queue.receive() == []
    with pytest.raises(ValueError):
        queue.receive(max_messages=11)
    with pytest.raises(ValueError):
        queue.receive(max_messages=0)
    with pytest.raises(ValueError):
        SqsMessageQueue(make_client(), URL, wait_seconds=21)


def test_receive_failure_is_a_transient_queue_error(sqs: tuple[SqsMessageQueue, Stubber]) -> None:
    queue, stub = sqs
    stub.add_client_error(
        "receive_message", service_error_code="InternalError", http_status_code=500
    )
    with pytest.raises(QueueError) as caught:
        queue.receive()
    assert caught.value.transient


def test_ack_and_release(sqs: tuple[SqsMessageQueue, Stubber]) -> None:
    queue, stub = sqs
    stub.add_response("delete_message", {}, {"QueueUrl": URL, "ReceiptHandle": "rh-1"})
    queue.ack(delivery())
    stub.add_response(
        "change_message_visibility",
        {},
        {"QueueUrl": URL, "ReceiptHandle": "rh-1", "VisibilityTimeout": 45},
    )
    queue.release(delivery(), delay_seconds=45)
    with pytest.raises(ValueError):
        queue.release(delivery(), delay_seconds=-1)


def test_stale_receipts_are_ignored(sqs: tuple[SqsMessageQueue, Stubber]) -> None:
    queue, stub = sqs
    stub.add_client_error("delete_message", service_error_code="ReceiptHandleIsInvalid")
    queue.ack(delivery())
    stub.add_client_error(
        "change_message_visibility",
        service_error_code="AWS.SimpleQueueService.MessageNotInflight",
    )
    queue.release(delivery())


def test_other_ack_failures_propagate(sqs: tuple[SqsMessageQueue, Stubber]) -> None:
    queue, stub = sqs
    stub.add_client_error("delete_message", service_error_code="AccessDenied", http_status_code=403)
    with pytest.raises(QueueError):
        queue.ack(delivery())
