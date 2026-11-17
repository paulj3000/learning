import { Duration } from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

/**
 * `lai-dev-power`: the nightly stop and morning start of the native dev environment, as a
 * STANDARD Step Functions state machine built only from AWS SDK integrations (no Lambda).
 *
 * Input: `{"action":"start"|"stop", "source":"schedule"|"manual"|"github"|"rds-event",
 * "force":false}` (`source` defaults to `manual`, `force` to false).
 *
 * stop: a `schedule` or `rds-event` stop is skipped while `/lai/dev/power/schedule-paused` is
 * `true` or `/lai/dev/power/hold-until` is a timestamp later than now; an `rds-event` stop (RDS
 * restarted a stopped instance after seven days) is also skipped while the power state is
 * `running`. `force` ignores both. Then: state `stopping`, quiesce Django on the instance over
 * SSM (best effort, bounded), stop EC2 and wait, stop RDS once it is `available` and wait, state
 * `stopped`.
 *
 * start: a paused `schedule` start is skipped. Then: state `starting`, start RDS and wait for
 * `available`, start EC2 and wait for `running`, wait for the SSM agent to be Online, run
 * `lai-dev-native-power` with `Action=verify` and wait for it, state `running` (or `degraded`
 * and the execution fails).
 *
 * Every wait is a bounded loop; a target already in the wanted state is a no-op. The outcome is
 * written to `/lai/dev/power/last-result` as JSON.
 */

export const POWER_PREFIX = '/lai/dev/power/';
export const POWER_STATE_MACHINE_NAME = 'lai-dev-power';

/** Loop bounds: polls times the wait between them. */
export const POWER_LOOPS = {
  ec2: { max: 40, waitSeconds: 15 }, // 10 minutes
  rds: { max: 60, waitSeconds: 30 }, // 30 minutes
  ssmPing: { max: 40, waitSeconds: 15 }, // 10 minutes
  quiesce: { max: 12, waitSeconds: 10 }, // 2 minutes
  verify: { max: 100, waitSeconds: 20 }, // about 33 minutes (verify may apply a pending release)
};

export interface PowerStateMachineProps {
  instanceId: string;
  instanceArn: string;
  databaseIdentifier: string;
  databaseArn: string;
  powerDocumentName: string;
  powerDocumentArn: string;
  /** `arn:...:parameter/lai/dev/power/<name>` for a parameter name (or `*`). */
  powerParameterArn: (name: string) => string;
  logGroup: logs.ILogGroup;
}

export class PowerStateMachine extends Construct {
  readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: PowerStateMachineProps) {
    super(scope, id);
    const powerParams = [props.powerParameterArn('*')];
    const retry = (task: tasks.CallAwsService) => {
      task.addRetry({
        errors: ['States.ALL'],
        maxAttempts: 3,
        interval: Duration.seconds(5),
        backoffRate: 2,
      });
      return task;
    };

    // --- Terminal failure: the last resort when a read or write of the power parameters fails.
    const crashed = new sfn.Fail(this, 'PowerCrashed', {
      error: 'PowerError',
      cause: 'An AWS call failed after retries; see the execution history',
    });
    const crash = (task: tasks.CallAwsService) => {
      retry(task).addCatch(crashed, { errors: ['States.ALL'], resultPath: '$.error' });
      return task;
    };

    const getParam = (stateId: string, name: string, path: string) =>
      crash(
        new tasks.CallAwsService(this, stateId, {
          service: 'ssm',
          action: 'getParameter',
          iamAction: 'ssm:GetParameter',
          iamResources: powerParams,
          parameters: { Name: `${POWER_PREFIX}${name}` },
          resultSelector: { 'value.$': '$.Parameter.Value' },
          resultPath: path,
        }),
      );
    const putParam = (stateId: string, name: string, value: string) =>
      crash(
        new tasks.CallAwsService(this, stateId, {
          service: 'ssm',
          action: 'putParameter',
          iamAction: 'ssm:PutParameter',
          iamResources: powerParams,
          parameters: {
            Name: `${POWER_PREFIX}${name}`,
            Value: value,
            Type: 'String',
            Overwrite: true,
          },
          resultPath: sfn.JsonPath.DISCARD,
        }),
      );
    /** Writes `$.result` to last-result, then ends (Succeed or Fail). */
    const finish = (stateId: string, end: sfn.IChainable) =>
      putParam(
        `Write${stateId}Result`,
        'last-result',
        sfn.JsonPath.jsonToString(sfn.JsonPath.objectAt('$.result')),
      ).next(end);
    const result = (stateId: string, outcome: string, reason: string) =>
      new sfn.Pass(this, stateId, {
        parameters: {
          'action.$': '$.action',
          'source.$': '$.source',
          outcome,
          reason,
          at: sfn.JsonPath.stateEnteredTime,
          execution: sfn.JsonPath.executionName,
        },
        resultPath: '$.result',
      });

    // --- Shared outcome tails -------------------------------------------------------------------
    const skipped = finish('Skipped', new sfn.Succeed(this, 'SkippedDone'));
    const degradedFail = new sfn.Fail(this, 'Degraded', {
      error: 'PowerDegraded',
      cause: 'The dev environment did not reach the requested power state; see last-result',
    });
    const degraded = putParam('WriteDegradedState', 'state', 'degraded').next(
      finish('Degraded', degradedFail),
    );
    const fail = (stateId: string, reason: string) =>
      result(stateId, 'degraded', reason).next(degraded);

    // --- AWS calls ------------------------------------------------------------------------------
    const describeInstance = (stateId: string) =>
      crash(
        new tasks.CallAwsService(this, stateId, {
          service: 'ec2',
          action: 'describeInstances',
          iamAction: 'ec2:DescribeInstances',
          iamResources: ['*'], // no resource-level permissions
          parameters: { InstanceIds: [props.instanceId] },
          resultSelector: { 'state.$': '$.Reservations[0].Instances[0].State.Name' },
          resultPath: '$.ec2',
        }),
      );
    const describeDatabase = (stateId: string) =>
      crash(
        new tasks.CallAwsService(this, stateId, {
          service: 'rds',
          action: 'describeDBInstances',
          iamAction: 'rds:DescribeDBInstances',
          iamResources: [props.databaseArn],
          parameters: { DbInstanceIdentifier: props.databaseIdentifier },
          resultSelector: { 'status.$': '$.DbInstances[0].DbInstanceStatus' },
          resultPath: '$.rds',
        }),
      );
    /** A state-changing call: a failure (wrong state, throttling) just waits and polls again. */
    const act = (
      stateId: string,
      service: string,
      action: string,
      iamAction: string,
      resource: string,
      parameters: Record<string, unknown>,
      onError: sfn.IChainable,
    ) =>
      new tasks.CallAwsService(this, stateId, {
        service,
        action,
        iamAction,
        iamResources: [resource],
        parameters,
        resultPath: sfn.JsonPath.DISCARD,
      }).addCatch(onError, { errors: ['States.ALL'], resultPath: '$.lastError' });
    const sendPower = (stateId: string, action: 'quiesce' | 'verify') =>
      new tasks.CallAwsService(this, stateId, {
        service: 'ssm',
        action: 'sendCommand',
        iamAction: 'ssm:SendCommand',
        iamResources: [props.powerDocumentArn, props.instanceArn],
        parameters: {
          DocumentName: props.powerDocumentName,
          InstanceIds: [props.instanceId],
          Parameters: { Action: [action] },
          TimeoutSeconds: 600,
          Comment: `lai-dev-power ${action}`,
        },
        resultSelector: { 'commandId.$': '$.Command.CommandId' },
        resultPath: `$.${action}`,
      });
    const getInvocation = (stateId: string, action: 'quiesce' | 'verify') =>
      new tasks.CallAwsService(this, stateId, {
        service: 'ssm',
        action: 'getCommandInvocation',
        iamAction: 'ssm:GetCommandInvocation',
        iamResources: ['*'], // no resource-level permissions
        parameters: {
          'CommandId.$': `$.${action}.commandId`,
          InstanceId: props.instanceId,
        },
        resultSelector: { 'status.$': '$.Status' },
        resultPath: `$.${action}Probe`,
      });

    /** `$.loop.count = 0`, then the check. */
    const loopStart = (stateId: string, first: sfn.IChainable) =>
      new sfn.Pass(this, stateId, {
        result: sfn.Result.fromObject({ count: 0 }),
        resultPath: '$.loop',
      }).next(first);
    /** Wait, `$.loop.count += 1`, then the check again. */
    const loopAgain = (stateId: string, seconds: number, check: sfn.IChainable) =>
      new sfn.Wait(this, `${stateId}Wait`, {
        time: sfn.WaitTime.duration(Duration.seconds(seconds)),
      })
        .next(
          new sfn.Pass(this, `${stateId}Count`, {
            parameters: { 'count.$': 'States.MathAdd($.loop.count, 1)' },
            resultPath: '$.loop',
          }),
        )
        .next(check);
    const exhausted = (max: number) => sfn.Condition.numberGreaterThanEquals('$.loop.count', max);
    const is = (path: string, value: string) => sfn.Condition.stringEquals(path, value);

    // =============================================================================================
    // stop
    // =============================================================================================
    const stopDone = result('Stopped', 'stopped', 'ok')
      .next(putParam('WriteStoppedState', 'state', 'stopped'))
      .next(finish('Stopped', new sfn.Succeed(this, 'StopSucceeded')));

    // RDS: stop once available; wait out starting, backing-up, modifying and stopping.
    const rdsStopCheck = describeDatabase('RdsStopCheck');
    const rdsStopAgain = loopAgain('RdsStop', POWER_LOOPS.rds.waitSeconds, rdsStopCheck);
    rdsStopCheck.next(
      new sfn.Choice(this, 'RdsStopRoute')
        .when(is('$.rds.status', 'stopped'), stopDone)
        .when(exhausted(POWER_LOOPS.rds.max), fail('RdsStopTimedOut', 'database did not stop'))
        .when(
          is('$.rds.status', 'available'),
          act(
            'StopDatabase',
            'rds',
            'stopDBInstance',
            'rds:StopDBInstance',
            props.databaseArn,
            { DbInstanceIdentifier: props.databaseIdentifier },
            rdsStopAgain,
          ).next(rdsStopAgain),
        )
        .otherwise(rdsStopAgain),
    );
    const rdsStop = loopStart('RdsStopBegin', rdsStopCheck);

    // EC2: quiesce Django once (best effort), stop, wait for stopped.
    const ec2StopCheck = describeInstance('Ec2StopCheck');
    const ec2StopAgain = loopAgain('Ec2Stop', POWER_LOOPS.ec2.waitSeconds, ec2StopCheck);
    const stopInstance = act(
      'StopInstance',
      'ec2',
      'stopInstances',
      'ec2:StopInstances',
      props.instanceArn,
      { InstanceIds: [props.instanceId] },
      ec2StopAgain,
    ).next(ec2StopAgain);

    const quiesceProbe = getInvocation('QuiesceProbe', 'quiesce');
    const quiesceWait = new sfn.Wait(this, 'QuiesceWait', {
      time: sfn.WaitTime.duration(Duration.seconds(POWER_LOOPS.quiesce.waitSeconds)),
    });
    const quiesceCount = new sfn.Pass(this, 'QuiesceCount', {
      parameters: { 'count.$': 'States.MathAdd($.quiesceLoop.count, 1)' },
      resultPath: '$.quiesceLoop',
    });
    quiesceWait.next(quiesceProbe);
    quiesceProbe.addCatch(quiesceCount, { errors: ['States.ALL'], resultPath: '$.lastError' });
    quiesceProbe.next(
      new sfn.Choice(this, 'QuiesceRoute')
        .when(
          sfn.Condition.and(
            sfn.Condition.numberLessThan('$.quiesceLoop.count', POWER_LOOPS.quiesce.max),
            sfn.Condition.or(
              is('$.quiesceProbe.status', 'Pending'),
              is('$.quiesceProbe.status', 'InProgress'),
              is('$.quiesceProbe.status', 'Delayed'),
            ),
          ),
          quiesceCount,
        )
        .otherwise(stopInstance),
    );
    quiesceCount.next(
      new sfn.Choice(this, 'QuiesceBudget')
        .when(
          sfn.Condition.numberLessThan('$.quiesceLoop.count', POWER_LOOPS.quiesce.max),
          quiesceWait,
        )
        .otherwise(stopInstance),
    );
    const quiesceSkipped = new sfn.Pass(this, 'QuiesceSkipped', {
      result: sfn.Result.fromObject({ skipped: true }),
      resultPath: '$.quiesce',
    }).next(stopInstance);
    const quiesce = sendPower('Quiesce', 'quiesce');
    quiesce.addCatch(quiesceSkipped, { errors: ['States.ALL'], resultPath: '$.lastError' });
    quiesce
      .next(
        new sfn.Pass(this, 'QuiesceBegin', {
          result: sfn.Result.fromObject({ count: 0 }),
          resultPath: '$.quiesceLoop',
        }),
      )
      .next(quiesceWait);

    ec2StopCheck.next(
      new sfn.Choice(this, 'Ec2StopRoute')
        .when(is('$.ec2.state', 'stopped'), rdsStop)
        .when(exhausted(POWER_LOOPS.ec2.max), fail('Ec2StopTimedOut', 'instance did not stop'))
        .when(
          sfn.Condition.and(
            is('$.ec2.state', 'running'),
            sfn.Condition.not(sfn.Condition.isPresent('$.quiesce')),
          ),
          quiesce,
        )
        .when(is('$.ec2.state', 'running'), stopInstance)
        .otherwise(ec2StopAgain),
    );
    const beginStop = putParam('WriteStoppingState', 'state', 'stopping').next(
      loopStart('Ec2StopBegin', ec2StopCheck),
    );

    const fromAutomation = sfn.Condition.or(
      is('$.source', 'schedule'),
      is('$.source', 'rds-event'),
    );
    const stopGate = new sfn.Choice(this, 'StopGate')
      .when(sfn.Condition.booleanEquals('$.force', true), beginStop)
      .when(
        sfn.Condition.and(fromAutomation, is('$.power.paused.value', 'true')),
        result('StopSkippedPaused', 'skipped', 'schedule-paused').next(skipped),
      )
      .when(
        sfn.Condition.and(
          fromAutomation,
          sfn.Condition.isTimestamp('$.power.hold.value'),
          sfn.Condition.timestampGreaterThanJsonPath('$.power.hold.value', '$.now'),
        ),
        result('StopSkippedHeld', 'skipped', 'hold-until').next(skipped),
      )
      .when(
        sfn.Condition.and(is('$.source', 'rds-event'), is('$.power.state.value', 'running')),
        result('StopSkippedRunning', 'skipped', 'environment-running').next(skipped),
      )
      .otherwise(beginStop);

    // =============================================================================================
    // start
    // =============================================================================================
    const startDone = result('Started', 'running', 'ok')
      .next(putParam('WriteRunningState', 'state', 'running'))
      .next(finish('Started', new sfn.Succeed(this, 'StartSucceeded')));

    // Verify on the instance (nginx, gunicorn, database, readiness; may apply a pending release).
    const verifyProbe = getInvocation('VerifyProbe', 'verify');
    const verifyAgain = loopAgain('Verify', POWER_LOOPS.verify.waitSeconds, verifyProbe);
    verifyProbe.addCatch(verifyAgain, { errors: ['States.ALL'], resultPath: '$.lastError' });
    verifyProbe.next(
      new sfn.Choice(this, 'VerifyRoute')
        .when(is('$.verifyProbe.status', 'Success'), startDone)
        .when(exhausted(POWER_LOOPS.verify.max), fail('VerifyTimedOut', 'verify did not finish'))
        .when(
          sfn.Condition.or(
            is('$.verifyProbe.status', 'Pending'),
            is('$.verifyProbe.status', 'InProgress'),
            is('$.verifyProbe.status', 'Delayed'),
          ),
          verifyAgain,
        )
        .otherwise(fail('VerifyFailed', 'verify failed')),
    );
    const verify = sendPower('Verify', 'verify');
    verify.addRetry({
      errors: ['States.ALL'],
      maxAttempts: 4,
      interval: Duration.seconds(20),
      backoffRate: 2,
    });
    verify.addCatch(fail('VerifyNotSent', 'verify could not be sent'), {
      errors: ['States.ALL'],
      resultPath: '$.lastError',
    });
    // The first probe waits: a fresh invocation is not visible at once.
    verify.next(loopStart('VerifyBegin', verifyAgain));

    // SSM agent Online.
    const pingCheck = crash(
      new tasks.CallAwsService(this, 'SsmPingCheck', {
        service: 'ssm',
        action: 'describeInstanceInformation',
        iamAction: 'ssm:DescribeInstanceInformation',
        iamResources: ['*'], // no resource-level permissions
        parameters: { Filters: [{ Key: 'InstanceIds', Values: [props.instanceId] }] },
        resultSelector: { 'list.$': '$.InstanceInformationList' },
        resultPath: '$.ssm',
      }),
    );
    pingCheck.next(
      new sfn.Choice(this, 'SsmPingRoute')
        .when(
          sfn.Condition.and(
            sfn.Condition.isPresent('$.ssm.list[0].PingStatus'),
            is('$.ssm.list[0].PingStatus', 'Online'),
          ),
          verify,
        )
        .when(exhausted(POWER_LOOPS.ssmPing.max), fail('SsmPingTimedOut', 'SSM agent not online'))
        .otherwise(loopAgain('SsmPing', POWER_LOOPS.ssmPing.waitSeconds, pingCheck)),
    );

    // EC2: start once stopped; wait out pending and stopping.
    const ec2StartCheck = describeInstance('Ec2StartCheck');
    const ec2StartAgain = loopAgain('Ec2Start', POWER_LOOPS.ec2.waitSeconds, ec2StartCheck);
    ec2StartCheck.next(
      new sfn.Choice(this, 'Ec2StartRoute')
        .when(is('$.ec2.state', 'running'), loopStart('SsmPingBegin', pingCheck))
        .when(exhausted(POWER_LOOPS.ec2.max), fail('Ec2StartTimedOut', 'instance did not start'))
        .when(
          is('$.ec2.state', 'stopped'),
          act(
            'StartInstance',
            'ec2',
            'startInstances',
            'ec2:StartInstances',
            props.instanceArn,
            { InstanceIds: [props.instanceId] },
            ec2StartAgain,
          ).next(ec2StartAgain),
        )
        .otherwise(ec2StartAgain),
    );

    // RDS: start once stopped; wait for available.
    const rdsStartCheck = describeDatabase('RdsStartCheck');
    const rdsStartAgain = loopAgain('RdsStart', POWER_LOOPS.rds.waitSeconds, rdsStartCheck);
    rdsStartCheck.next(
      new sfn.Choice(this, 'RdsStartRoute')
        .when(is('$.rds.status', 'available'), loopStart('Ec2StartBegin', ec2StartCheck))
        .when(exhausted(POWER_LOOPS.rds.max), fail('RdsStartTimedOut', 'database did not start'))
        .when(
          is('$.rds.status', 'stopped'),
          act(
            'StartDatabase',
            'rds',
            'startDBInstance',
            'rds:StartDBInstance',
            props.databaseArn,
            { DbInstanceIdentifier: props.databaseIdentifier },
            rdsStartAgain,
          ).next(rdsStartAgain),
        )
        .otherwise(rdsStartAgain),
    );
    const beginStart = putParam('WriteStartingState', 'state', 'starting').next(
      loopStart('RdsStartBegin', rdsStartCheck),
    );
    const startGate = new sfn.Choice(this, 'StartGate')
      .when(
        sfn.Condition.and(is('$.source', 'schedule'), is('$.power.paused.value', 'true')),
        result('StartSkippedPaused', 'skipped', 'schedule-paused').next(skipped),
      )
      .otherwise(beginStart);

    // =============================================================================================
    // request
    // =============================================================================================
    const invalid = new sfn.Fail(this, 'InvalidRequest', {
      error: 'InvalidRequest',
      cause: 'action must be start or stop; source schedule, manual, github or rds-event',
    });
    const normalize = new sfn.Pass(this, 'Normalize', {
      parameters: {
        'action.$': '$.action',
        'source.$': '$.source',
        'force.$': '$.force',
        now: sfn.JsonPath.stateEnteredTime,
      },
    });
    normalize
      .next(getParam('ReadSchedulePaused', 'schedule-paused', '$.power.paused'))
      .next(getParam('ReadHoldUntil', 'hold-until', '$.power.hold'))
      .next(getParam('ReadPowerState', 'state', '$.power.state'))
      .next(
        new sfn.Choice(this, 'RouteAction')
          .when(is('$.action', 'stop'), stopGate)
          .otherwise(startGate),
      );
    const forceDefault = new sfn.Choice(this, 'CheckForce')
      .when(
        sfn.Condition.and(sfn.Condition.isPresent('$.force'), sfn.Condition.isBoolean('$.force')),
        normalize,
      )
      .otherwise(
        new sfn.Pass(this, 'DefaultForce', {
          result: sfn.Result.fromBoolean(false),
          resultPath: '$.force',
        }).next(normalize),
      );
    const sourceDefault = new sfn.Choice(this, 'CheckSource')
      .when(
        sfn.Condition.not(sfn.Condition.isPresent('$.source')),
        new sfn.Pass(this, 'DefaultSource', {
          result: sfn.Result.fromString('manual'),
          resultPath: '$.source',
        }).next(forceDefault),
      )
      .when(
        sfn.Condition.or(
          is('$.source', 'schedule'),
          is('$.source', 'manual'),
          is('$.source', 'github'),
          is('$.source', 'rds-event'),
        ),
        forceDefault,
      )
      .otherwise(invalid);
    const validate = new sfn.Choice(this, 'ValidateRequest')
      .when(
        sfn.Condition.and(
          sfn.Condition.isPresent('$.action'),
          sfn.Condition.isString('$.action'),
          sfn.Condition.or(is('$.action', 'start'), is('$.action', 'stop')),
        ),
        sourceDefault,
      )
      .otherwise(invalid);

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      stateMachineName: POWER_STATE_MACHINE_NAME,
      stateMachineType: sfn.StateMachineType.STANDARD,
      comment: 'Native dev environment nightly stop and morning start (SDK integrations only)',
      definitionBody: sfn.DefinitionBody.fromChainable(validate),
      timeout: Duration.hours(2),
      logs: { destination: props.logGroup, level: sfn.LogLevel.ERROR, includeExecutionData: false },
    });
  }
}
